import http from "node:http";
import { createTossMtlsCore, clientError, publicError } from "@trailbase-apps-in-toss-kit/toss-mtls-core";
import { PROXY_ENDPOINTS } from "@trailbase-apps-in-toss-kit/toss-mtls-client";
import { createConfig, requestBodyLimitBytes, validateConfig } from "./config.mjs";
import { createNodeMtlsTransport } from "./node-transport.mjs";

export function createProxyServer(config = createConfig()) {
  validateConfig(config);
  const core = createCore(config);
  return http.createServer((req, res) => {
    handleRequest(req, config, core)
      .then(({ status, body }) => writeJson(res, status, body))
      .catch((error) => {
        const safeError = publicError(error);
        writeJson(res, safeError.status, {
          ok: false,
          error: safeError.code,
          message: safeError.message,
        });
      });
  });
}

export async function handleRequest(req, config = createConfig(), core = createCore(config)) {
  if (!isAuthorized(req, config)) {
    return response(401, { ok: false, error: "UNAUTHORIZED" });
  }

  const url = new URL(req.url || "/", "http://internal.local");

  if (req.method === "GET" && url.pathname === PROXY_ENDPOINTS.health) {
    return response(200, await core.health());
  }

  if (req.method === "POST" && url.pathname === PROXY_ENDPOINTS.genericMtlRequest) {
    const body = await readJson(req, requestBodyLimitBytes(config));
    return response(200, await core.genericMtlsRequest(body));
  }

  if (req.method === "POST" && url.pathname === PROXY_ENDPOINTS.tossLoginComplete) {
    const body = await readJson(req, requestBodyLimitBytes(config));
    return response(200, await core.tossLoginComplete(body));
  }

  if (req.method === "POST" && url.pathname === PROXY_ENDPOINTS.tossLoginRemoveByUserKey) {
    const body = await readJson(req, requestBodyLimitBytes(config));
    return response(200, await core.tossLoginRemoveByUserKey(body));
  }

  if (req.method === "POST" && url.pathname === PROXY_ENDPOINTS.iapOrderStatus) {
    const body = await readJson(req, requestBodyLimitBytes(config));
    return response(200, await core.iapOrderStatus(body));
  }

  if (req.method === "POST" && url.pathname === PROXY_ENDPOINTS.promotionRewardGrant) {
    const body = await readJson(req, requestBodyLimitBytes(config));
    return response(200, await core.promotionRewardGrant(body));
  }

  if (req.method === "POST" && url.pathname === PROXY_ENDPOINTS.smartMessageSend) {
    const body = await readJson(req, requestBodyLimitBytes(config));
    return response(200, await core.smartMessageSend(body));
  }

  if (req.method === "POST" && url.pathname === PROXY_ENDPOINTS.smartMessageBulkSend) {
    const body = await readJson(req, requestBodyLimitBytes(config));
    return response(200, await core.smartMessageBulkSend(body));
  }

  return response(404, { ok: false, error: "NOT_FOUND" });
}

function createCore(config) {
  return createTossMtlsCore({
    mode: config.mode,
    transport: createNodeMtlsTransport(config),
    tossPromotionCode: config.tossPromotionCode,
    tossPromotionAmount: config.tossPromotionAmount,
    iapOrderStatusMaxAttempts: config.iapOrderStatusMaxAttempts,
    iapOrderStatusRetryDelayMs: config.iapOrderStatusRetryDelayMs,
    debug: config.debug,
    log: (message, fields) => console.info(`[toss-mtls-client-proxy] ${message}`, fields),
  });
}

function isAuthorized(req, config) {
  if (!config.internalToken) return true;
  return req.headers.authorization === `Bearer ${config.internalToken}`;
}

function readJson(req, limitBytes = requestBodyLimitBytes()) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let receivedBytes = 0;
    let settled = false;
    const settle = (fn, value) => {
      if (settled) return;
      settled = true;
      fn(value);
    };
    req.on("data", (chunk) => {
      receivedBytes += byteLength(chunk);
      if (receivedBytes > limitBytes) {
        settle(reject, clientError("REQUEST_BODY_TOO_LARGE", "Request body is too large", 413));
      } else {
        chunks.push(chunk);
      }
    });
    req.on("end", () => {
      if (settled) return;
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return settle(resolve, {});
      try {
        settle(resolve, JSON.parse(raw));
      } catch (error) {
        settle(reject, clientError("INVALID_JSON", "Invalid JSON", 400, error));
      }
    });
    req.on("error", (error) => {
      settle(reject, error);
    });
  });
}

function writeJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function response(status, body) {
  return { status, body };
}

function byteLength(chunk) {
  return Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(String(chunk));
}
