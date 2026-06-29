import http from "node:http";
import https from "node:https";
import { existsSync, readFileSync } from "node:fs";
import {
  configError,
  clientError,
  parseMaybeJson,
  sanitizeHeaders,
  sanitizeResponseHeaders,
  upstreamError,
} from "@trailbase-apps-in-toss-kit/toss-mtls-core";
import { requestBodyLimitBytes, upstreamBodyLimitBytes, upstreamTimeoutMs } from "./config.mjs";

export function createNodeMtlsTransport(config) {
  return {
    request: (request) => forwardJson(request, config),
  };
}

async function forwardJson(request, config) {
  if (!config.upstreamBaseUrl) {
    throw configError("MISSING_MTLS_UPSTREAM_BASE_URL", "MTLS_UPSTREAM_BASE_URL is required in forward mode");
  }
  const target = new URL(request.path, config.upstreamBaseUrl);
  const payload = request.body === undefined ? undefined : Buffer.from(JSON.stringify(request.body));
  if (payload && payload.length > requestBodyLimitBytes(config)) {
    throw clientError("REQUEST_BODY_TOO_LARGE", "Request body is too large", 413);
  }
  const headers = {
    accept: "application/json",
    ...sanitizeHeaders(request.headers),
  };
  if (payload) {
    headers["content-type"] = headers["content-type"] || "application/json";
    headers["content-length"] = String(payload.length);
  }
  if (request.tossUserKey) {
    headers["x-toss-user-key"] = request.tossUserKey;
  }

  const options = {
    method: request.method,
    protocol: target.protocol,
    hostname: target.hostname,
    port: target.port || undefined,
    path: `${target.pathname}${target.search}`,
    headers,
  };

  if (target.protocol === "https:") {
    options.cert = readRequiredFile(config.clientCertPath, "MTLS_CLIENT_CERT_PATH");
    options.key = readRequiredFile(config.clientKeyPath, "MTLS_CLIENT_KEY_PATH");
    if (config.caCertPath && existsSync(config.caCertPath)) {
      options.ca = readFileSync(config.caCertPath);
    }
  }

  const transport = target.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (fn, value) => {
      if (settled) return;
      settled = true;
      fn(value);
    };
    const upstream = transport.request(options, (upstreamRes) => {
      const chunks = [];
      let receivedBytes = 0;
      upstreamRes.on("data", (chunk) => {
        receivedBytes += byteLength(chunk);
        if (receivedBytes > upstreamBodyLimitBytes(config)) {
          settle(reject, upstreamError("UPSTREAM_RESPONSE_TOO_LARGE", "Upstream response was too large", 502));
          upstream.destroy();
        } else {
          chunks.push(chunk);
        }
      });
      upstreamRes.on("end", () => {
        if (settled) return;
        const raw = Buffer.concat(chunks).toString("utf8");
        settle(resolve, {
          status: upstreamRes.statusCode || 500,
          headers: sanitizeResponseHeaders(upstreamRes.headers),
          body: parseMaybeJson(raw),
        });
      });
    });
    upstream.setTimeout(upstreamTimeoutMs(config), () => {
      settle(reject, upstreamError("UPSTREAM_TIMEOUT", "Upstream request timed out", 504));
      upstream.destroy();
    });
    upstream.on("error", (error) => {
      settle(reject, upstreamError("UPSTREAM_REQUEST_FAILED", "Upstream request failed", 502, error));
    });
    if (payload) upstream.write(payload);
    upstream.end();
  });
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

function byteLength(chunk) {
  return Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(String(chunk));
}
