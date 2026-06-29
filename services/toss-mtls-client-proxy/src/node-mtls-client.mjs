import http from "node:http";
import https from "node:https";
import { existsSync, readFileSync } from "node:fs";
import {
  configError,
  clientError,
  sanitizeHeaders,
  upstreamError,
} from "@trailbase-apps-in-toss-kit/toss-mtls-core";
import { requestBodyLimitBytes, upstreamBodyLimitBytes, upstreamTimeoutMs } from "./config.mjs";

export function createNodeMtlsClient(config) {
  return {
    request: (url, init = {}) => forward(url, init, config),
  };
}

async function forward(url, init, config) {
  const target = new URL(url);
  const payload = bodyBuffer(init.body);
  if (payload && payload.length > requestBodyLimitBytes(config)) {
    throw clientError("REQUEST_BODY_TOO_LARGE", "Request body is too large", 413);
  }
  const headers = {
    accept: "application/json",
    ...sanitizeHeaders(headersObject(init.headers)),
  };
  if (payload) {
    headers["content-type"] = headers["content-type"] || "application/json";
    headers["content-length"] = String(payload.length);
  }

  const options = {
    method: String(init.method || "GET").toUpperCase(),
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
        const status = upstreamRes.statusCode || 500;
        settle(
          resolve,
          new Response(status === 204 || status === 304 ? null : raw, {
            status,
            headers: responseHeaders(upstreamRes.headers),
          }),
        );
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

function bodyBuffer(body) {
  if (body === undefined || body === null) return undefined;
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (body instanceof ArrayBuffer) return Buffer.from(body);
  if (typeof body === "string") return Buffer.from(body);
  return Buffer.from(String(body));
}

function headersObject(headers) {
  if (!headers) return {};
  if (headers instanceof Headers) {
    const out = {};
    headers.forEach((value, key) => {
      out[key] = value;
    });
    return out;
  }
  if (Array.isArray(headers)) {
    return Object.fromEntries(headers);
  }
  return headers;
}

function responseHeaders(headers) {
  const out = {};
  for (const [key, value] of Object.entries(headers || {})) {
    if (value === undefined) continue;
    out[key] = Array.isArray(value) ? value.join(",") : String(value);
  }
  return out;
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
