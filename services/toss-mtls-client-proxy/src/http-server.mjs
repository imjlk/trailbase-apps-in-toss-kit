import http from "node:http";
import { createTossMtlsCore, clientError, TOSS_ENDPOINTS, publicError as corePublicError } from "@ait-kit/api-core";
import { PROXY_ENDPOINTS } from "@ait-kit/api-client";
import { createConfig, requestBodyLimitBytes, validateConfig } from "./config.mjs";
import { createNodeMtlsClient } from "./node-mtls-client.mjs";

export const PROMOTION_REWARD_STATUS_PATH = "/internal/apps-in-toss/promotion/reward/status";

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
    const health = await core.health();
    return response(200, { ok: health.ok, mode: health.mode });
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

  if (req.method === "POST" && url.pathname === PROMOTION_REWARD_STATUS_PATH) {
    const body = await readJson(req, requestBodyLimitBytes(config));
    const key = typeof body?.providerTransactionKey === "string" ? body.providerTransactionKey.trim() : "";
    if (!key) {
      throw clientError("MISSING_PROMOTION_TRANSACTION_KEY", "providerTransactionKey is required for result lookup");
    }
    // api-core skips get-key and execute when an existing transaction key is supplied.
    return response(200, await core.promotionRewardGrant({ ...body, providerTransactionKey: key }));
  }

  if (req.method === "POST" && url.pathname === PROXY_ENDPOINTS.smartMessageSend) {
    const body = await readJson(req, requestBodyLimitBytes(config));
    return response(200, compatibleMessageResponse(await core.smartMessageSend(body)));
  }

  if (req.method === "POST" && url.pathname === PROXY_ENDPOINTS.smartMessageBulkSend) {
    const body = await readJson(req, requestBodyLimitBytes(config));
    return response(200, compatibleMessageResponse(await core.smartMessageBulkSend(body)));
  }

  return response(404, { ok: false, error: "NOT_FOUND" });
}

function createCore(config) {
  const transport = createNodeMtlsClient(config);
  return createTossMtlsCore({
    // This authenticated internal proxy intentionally exposes the generic relay.
    allowRawMtls: true,
    mode: config.mode,
    upstreamBaseUrl: config.upstreamBaseUrl,
    tossPromotionCode: config.tossPromotionCode,
    tossPromotionAmount: config.tossPromotionAmount,
    iapOrderStatusMaxAttempts: config.iapOrderStatusMaxAttempts,
    iapOrderStatusRetryDelayMs: config.iapOrderStatusRetryDelayMs,
    debug: config.debug,
    log: (message, fields) => console.info(`[toss-mtls-client-proxy] ${message}`, fields),
    mtlsClient: {
      request(url, init) {
        // api-core 0.2.0 emits x-user-key for single messages. The official
        // messenger API still requires x-toss-user-key (api/push).
        if (new URL(url).pathname === TOSS_ENDPOINTS.messageSend) {
          const headers = new Headers(init.headers);
          if (headers.has("x-user-key")) {
            headers.set("x-toss-user-key", headers.get("x-user-key"));
            headers.delete("x-user-key");
          }
          return transport.request(url, { ...init, headers });
        }
        return transport.request(url, init);
      },
    },
  });
}

function compatibleMessageResponse(result) {
  // Preserve the proxy's partial-delivery summary alongside new channel detail.
  const failures = result.failures?.map((failure) => ({
    ...failure,
    reachFailReason: failure.reachFailReason ?? failure.reachedFailReason,
  }));
  const reason = failures?.find((failure) => failure.reachFailReason)?.reachFailReason;
  return {
    ...result,
    ...(failures ? { failures } : {}),
    ...(reason && !result.failureReason ? { failureReason: reason } : {}),
  };
}

function publicError(error) {
  const safeError = corePublicError(error);
  if (safeError.status === 500 && safeError.code === "APPS_IN_TOSS_API_ERROR") {
    return {
      status: 500,
      code: "PROXY_ERROR",
      message: "Proxy request failed",
    };
  }
  return safeError;
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
