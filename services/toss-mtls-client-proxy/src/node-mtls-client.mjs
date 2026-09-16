import http from "node:http";
import { readFileSync } from "node:fs";
import { clientError, configError } from "@ait-kit/api-core";
import {
  NodeMtlsTransportError,
  createNodeMtlsTransport,
} from "@ait-kit/api-client/node";
import { requestBodyLimitBytes, upstreamBodyLimitBytes, upstreamTimeoutMs } from "./config.mjs";

// Adapter over @ait-kit/api-client/node's transport for HTTPS upstreams.
// The proxy keeps ownership of concerns the package intentionally leaves
// out: certificate FILE loading (the transport takes PEM contents — read
// lazily so stub/plain-HTTP deployments never touch cert material), plain
// HTTP forwarding for local/test upstreams, request body limits (an
// HTTP-server policy), and proxy-specific error codes.
export function createNodeMtlsClient(config) {
  let transport;
  return {
    request: (url, init = {}) => forward(url, init, config, () => {
      transport ??= createNodeMtlsTransport({
        ...readCertificateMaterial(config),
        timeoutMs: upstreamTimeoutMs(config),
        maxResponseBytes: upstreamBodyLimitBytes(config),
      });
      return transport;
    }),
  };
}

async function forward(url, init, config, getTransport) {
  const payload = bodyBuffer(init.body);
  if (payload && payload.length > requestBodyLimitBytes(config)) {
    throw clientError("REQUEST_BODY_TOO_LARGE", "Request body is too large", 413);
  }
  const target = new URL(url);
  if (target.protocol === "https:") {
    return await getTransport().request(url, init);
  }
  return await forwardPlainHttp(target, init, payload, config);
}

// Plain-HTTP path for local/test upstreams; no certificate material
// needed. Mirrors the ait-kit transport's guarantees: one overall deadline
// across headers and the full body, and a connection that breaks before the
// body completes is an error — never a hang and never partial data.
const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length",
]);

async function forwardPlainHttp(target, init, payload, config) {
  // Mirror the shared transport's header sanitization: caller-supplied
  // hop-by-hop headers (transfer-encoding, connection, host, ...) must be
  // dropped before the framed plain-HTTP request, or Node rejects the
  // conflicting framing outright.
  const rawHeaders = init.headers ? Object.fromEntries(new Headers(init.headers)) : {};
  const headers = {
    accept: "application/json",
  };
  for (const [name, value] of Object.entries(rawHeaders)) {
    if (HOP_BY_HOP_HEADERS.has(name.toLowerCase())) continue;
    headers[name] = value;
  }
  if (payload) {
    headers["content-type"] = headers["content-type"] || "application/json";
    headers["content-length"] = String(payload.length);
  }
  const timeoutMs = upstreamTimeoutMs(config);
  return new Promise((resolve, reject) => {
    let settled = false;
    let ended = false;
    let timer;
    const settle = (fn, value) => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      fn(value);
    };
    const upstream = http.request(
      {
        method: String(init.method || "GET").toUpperCase(),
        hostname: target.hostname,
        port: target.port || undefined,
        path: `${target.pathname}${target.search}`,
        headers,
      },
      (upstreamRes) => {
        const chunks = [];
        let receivedBytes = 0;
        let truncated = false;
        upstreamRes.on("data", (chunk) => {
          if (settled) return;
          receivedBytes += chunk.length;
          if (receivedBytes > upstreamBodyLimitBytes(config)) {
            truncated = true;
            upstream.destroy();
            settle(reject, new NodeMtlsTransportError("RESPONSE_TOO_LARGE", "Upstream response was too large"));
            return;
          }
          chunks.push(chunk);
        });
        upstreamRes.on("aborted", () => {
          settle(reject, new NodeMtlsTransportError("REQUEST_FAILED", "Upstream response aborted"));
        });
        upstreamRes.on("error", (error) => {
          settle(reject, new NodeMtlsTransportError("REQUEST_FAILED", `Upstream request failed: ${error instanceof Error ? error.message : String(error)}`));
        });
        upstreamRes.on("close", () => {
          if (!settled && !ended && !upstreamRes.readableEnded) {
            settle(reject, new NodeMtlsTransportError("REQUEST_FAILED", "Upstream connection closed before the response completed"));
          }
        });
        upstreamRes.on("end", () => {
          ended = true;
          if (settled || truncated) return;
          // Build the fetch Response first and settle only on success: a
          // construction failure (e.g. Node rejecting an out-of-range
          // upstream status like 600) must surface as the transport's typed
          // REQUEST_FAILED error, never as an unhandled throw that leaves
          // the caller's promise unsettled. 204/205/304 carry a null body.
          try {
            const raw = Buffer.concat(chunks).toString("utf8");
            const status = upstreamRes.statusCode || 500;
            const body = status === 204 || status === 205 || status === 304 ? null : raw;
            settle(resolve, new Response(body, {
              status,
              headers: responseHeaders(upstreamRes.headers),
            }));
          } catch (error) {
            settle(reject, new NodeMtlsTransportError(
              "REQUEST_FAILED",
              "failed to convert the completed upstream response",
              { cause: error },
            ));
          }
        });
      },
    );
    // The overall budget covers headers and the entire body, like the
    // mTLS transport; the socket inactivity timer alone cannot express it.
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        settle(reject, new NodeMtlsTransportError("TIMEOUT", "Upstream request timed out"));
        upstream.destroy();
      }, timeoutMs);
    }
    upstream.on("error", (error) => {
      settle(reject, new NodeMtlsTransportError("REQUEST_FAILED", `Upstream request failed: ${error instanceof Error ? error.message : String(error)}`));
    });
    if (payload) upstream.write(payload);
    upstream.end();
  });
}



function bodyBuffer(body) {
  if (body === undefined || body === null) return undefined;
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (body instanceof ArrayBuffer) return Buffer.from(body);
  if (typeof body === "string") return Buffer.from(body);
  if (body instanceof URLSearchParams) return Buffer.from(body.toString());
  throw clientError("UNSUPPORTED_REQUEST_BODY", "Unsupported request body type", 400);
}

function responseHeaders(headers) {
  const out = {};
  for (const [key, value] of Object.entries(headers || {})) {
    if (value === undefined) continue;
    out[key] = Array.isArray(value) ? value.join(",") : String(value);
  }
  return out;
}

function readCertificateMaterial(config) {
  const material = {
    cert: readRequiredFile(config.clientCertPath, "MTLS_CLIENT_CERT_PATH"),
    key: readRequiredFile(config.clientKeyPath, "MTLS_CLIENT_KEY_PATH"),
  };
  const ca = config.caCertPath ? readRequiredFile(config.caCertPath, "MTLS_CA_CERT_PATH") : undefined;
  if (ca) material.ca = ca;
  return material;
}

function readRequiredFile(path, name) {
  if (!path) {
    throw configError(`MISSING_${name}`, `${name} is required for HTTPS forward mode`);
  }
  try {
    return readFileSync(path);
  } catch (error) {
    throw configError(`${name}_UNREADABLE`, `${name} is missing or unreadable`, error);
  }
}
