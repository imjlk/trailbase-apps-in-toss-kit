import http from "node:http";
import https from "node:https";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

export const DEFAULT_PORT = 8787;
export const DEFAULT_CERT_DIR = "/run/mtls";
export const TOSS_ENDPOINTS = Object.freeze({
  loginGenerateToken: "/api-partner/v1/apps-in-toss/user/oauth2/generate-token",
  loginMe: "/api-partner/v1/apps-in-toss/user/oauth2/login-me",
  promotionGetKey: "/api-partner/v1/apps-in-toss/promotion/execute-promotion/get-key",
  promotionExecute: "/api-partner/v1/apps-in-toss/promotion/execute-promotion",
  promotionResult: "/api-partner/v1/apps-in-toss/promotion/execution-result",
  iapOrderStatus: "/api-partner/v1/apps-in-toss/order/get-order-status",
  messageSend: "/api-partner/v1/apps-in-toss/messenger/send-message",
});

export const PROXY_ENDPOINTS = Object.freeze({
  health: "/internal/apps-in-toss/health",
  genericMtlRequest: "/internal/mtls/request",
  tossLoginComplete: "/internal/apps-in-toss/toss-login/complete",
  iapOrderStatus: "/internal/apps-in-toss/iap/order/status",
  promotionRewardGrant: "/internal/apps-in-toss/promotion/reward/grant",
  smartMessageSend: "/internal/apps-in-toss/smart-message/send",
});

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

export function createConfig(env = process.env) {
  return {
    port: parsePositiveInteger(env.PORT, DEFAULT_PORT),
    mode: env.MTLS_PROXY_MODE || env.TOSS_PROXY_MODE || "stub",
    internalToken: env.MTLS_PROXY_TOKEN || env.TOSS_PROXY_INTERNAL_TOKEN || "",
    upstreamBaseUrl: env.MTLS_UPSTREAM_BASE_URL || env.TOSS_API_BASE_URL || "",
    clientCertPath: env.MTLS_CLIENT_CERT_PATH || `${DEFAULT_CERT_DIR}/client-cert.pem`,
    clientKeyPath: env.MTLS_CLIENT_KEY_PATH || `${DEFAULT_CERT_DIR}/client-key.pem`,
    caCertPath: env.MTLS_CA_CERT_PATH || `${DEFAULT_CERT_DIR}/ca-cert.pem`,
    tossPromotionCode: env.TOSS_PROMOTION_CODE || "",
    tossPromotionAmount: parsePositiveInteger(env.TOSS_PROMOTION_AMOUNT, 50),
  };
}

export function createProxyServer(config = createConfig()) {
  return http.createServer((req, res) => {
    handleRequest(req, config)
      .then(({ status, body }) => writeJson(res, status, body))
      .catch((error) =>
        writeJson(res, 500, {
          ok: false,
          error: "PROXY_ERROR",
          message: error instanceof Error ? error.message : String(error),
        }),
      );
  });
}

export async function handleRequest(req, config = createConfig()) {
  if (!isAuthorized(req, config)) {
    return response(401, { ok: false, error: "UNAUTHORIZED" });
  }

  const url = new URL(req.url || "/", "http://internal.local");

  if (req.method === "GET" && url.pathname === PROXY_ENDPOINTS.health) {
    return response(200, { ok: true, mode: config.mode });
  }

  if (req.method === "POST" && url.pathname === PROXY_ENDPOINTS.genericMtlRequest) {
    const body = await readJson(req);
    return response(200, await handleGenericMtlRequest(body, config));
  }

  if (req.method === "POST" && url.pathname === PROXY_ENDPOINTS.tossLoginComplete) {
    const body = await readJson(req);
    return response(200, config.mode === "forward" ? await completeTossLogin(body, config) : stubLoginResponse(body));
  }

  if (req.method === "POST" && url.pathname === PROXY_ENDPOINTS.iapOrderStatus) {
    const body = await readJson(req);
    return response(200, config.mode === "forward" ? await getIapOrderStatus(body, config) : stubIapOrderStatus(body));
  }

  if (req.method === "POST" && url.pathname === PROXY_ENDPOINTS.promotionRewardGrant) {
    const body = await readJson(req);
    return response(
      200,
      config.mode === "forward"
        ? await grantPromotionReward(body, config)
        : {
            ok: true,
            providerRequestId: body.providerRequestId,
            providerStatus: "GRANTED",
            grantedAt: body.requestedAt ?? Date.now(),
            providerTransactionKey: body.providerTransactionKey,
          },
    );
  }

  if (req.method === "POST" && url.pathname === PROXY_ENDPOINTS.smartMessageSend) {
    const body = await readJson(req);
    if (config.mode !== "forward") {
      return response(200, {
        ok: true,
        providerRequestId: body.providerRequestId,
        providerStatus: "SENT",
        sentAt: body.requestedAt ?? Date.now(),
      });
    }
    const upstream = await forwardJson(
      {
        method: "POST",
        path: TOSS_ENDPOINTS.messageSend,
        body: withoutTossUserKey(body),
        tossUserKey: body.tossUserKey,
      },
      config,
    );
    return response(200, normalizeMessageResponse(body, upstream.body));
  }

  return response(404, { ok: false, error: "NOT_FOUND" });
}

export async function handleGenericMtlRequest(body, config = createConfig()) {
  const request = normalizeGenericRequest(body);
  const upstream = await forwardJson(request, config);
  return {
    ok: upstream.status >= 200 && upstream.status < 300,
    status: upstream.status,
    headers: upstream.headers,
    body: upstream.body,
  };
}

function normalizeGenericRequest(body) {
  const method = String(body?.method || "POST").trim().toUpperCase();
  if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    throw new Error("Unsupported method");
  }
  const path = String(body?.path || "").trim();
  if (!path.startsWith("/") || path.startsWith("//") || /^https?:\/\//i.test(path)) {
    throw new Error("path must be a relative absolute path");
  }
  return {
    method,
    path,
    headers: sanitizeHeaders(body?.headers),
    body: body?.body,
    tossUserKey: stringOrUndefined(body?.tossUserKey),
  };
}

async function completeTossLogin(body, config) {
  const authorizationCode = String(body?.authorizationCode || body?.authorization_code || "").trim();
  if (!authorizationCode) {
    return { ok: false, error: "MISSING_AUTHORIZATION_CODE" };
  }

  const referrer = normalizeLoginReferrer(body?.referrer);
  const tokenResponse = await forwardJson(
    {
      method: "POST",
      path: TOSS_ENDPOINTS.loginGenerateToken,
      body: { authorizationCode, referrer },
    },
    config,
  );
  if (isUpstreamFailure(tokenResponse.body)) {
    return {
      ok: false,
      error: "TOKEN_EXCHANGE_FAILED",
      failureReason: upstreamFailureReason(tokenResponse.body),
    };
  }

  const accessToken = readPathString(tokenResponse.body, [
    "success.accessToken",
    "accessToken",
    "data.accessToken",
    "access_token",
    "success.access_token",
    "data.access_token",
  ]);
  if (!accessToken) {
    return { ok: false, error: "TOKEN_RESPONSE_MISSING_ACCESS_TOKEN" };
  }

  const userResponse = await forwardJson(
    {
      method: "GET",
      path: TOSS_ENDPOINTS.loginMe,
      headers: { authorization: `Bearer ${accessToken}` },
    },
    config,
  );
  if (isUpstreamFailure(userResponse.body)) {
    return {
      ok: false,
      error: "LOGIN_ME_FAILED",
      failureReason: upstreamFailureReason(userResponse.body),
    };
  }

  const userKey = readPathString(userResponse.body, [
    "success.userKey",
    "userKey",
    "data.userKey",
    "user_key",
    "success.user_key",
    "data.user_key",
  ]);
  if (!userKey) {
    return { ok: false, error: "LOGIN_ME_MISSING_USER_KEY" };
  }

  return {
    ok: true,
    userKey,
    referrer,
    scopes: normalizeScopes(
      readPathValue(userResponse.body, ["success.scope", "scope", "data.scope", "success.scopes", "scopes", "data.scopes"]) ??
        readPathValue(tokenResponse.body, ["success.scope", "scope", "data.scope", "success.scopes", "scopes", "data.scopes"]),
    ),
    agreedTerms: readPathValue(userResponse.body, ["success.agreedTerms", "agreedTerms", "data.agreedTerms"]) ?? [],
  };
}

async function getIapOrderStatus(request, config) {
  const orderId = stringOrUndefined(request?.orderId);
  const tossUserKey = stringOrUndefined(request?.tossUserKey);
  if (!orderId) {
    return { ok: false, error: "MISSING_ORDER_ID", providerStatus: "ERROR" };
  }
  if (!tossUserKey) {
    return { ok: false, error: "MISSING_TOSS_USER_KEY", providerStatus: "ERROR" };
  }

  const upstream = await forwardJson(
    {
      method: "POST",
      path: TOSS_ENDPOINTS.iapOrderStatus,
      body: { orderId },
      tossUserKey,
    },
    config,
  );
  return normalizeIapOrderStatusResponse(request, upstream.body);
}

async function grantPromotionReward(request, config) {
  const providerRequestId = stringOrUndefined(request?.providerRequestId);
  const requestedAt = numberOrUndefined(request?.requestedAt) ?? Date.now();
  const tossUserKey = stringOrUndefined(request?.tossUserKey);
  if (!tossUserKey) {
    return rewardFailure(request, "MISSING_TOSS_USER_KEY", "tossUserKey is required for promotion grant");
  }
  if (!config.tossPromotionCode) {
    return rewardFailure(request, "MISSING_TOSS_PROMOTION_CODE", "TOSS_PROMOTION_CODE is required");
  }

  let providerTransactionKey = stringOrUndefined(request?.providerTransactionKey);
  if (!providerTransactionKey) {
    const keyResponse = await forwardJson(
      { method: "POST", path: TOSS_ENDPOINTS.promotionGetKey, body: {}, tossUserKey },
      config,
    );
    if (isUpstreamFailure(keyResponse.body)) {
      return rewardFailure(request, "PROMOTION_KEY_FAILED", upstreamFailureReason(keyResponse.body));
    }
    providerTransactionKey = readPathString(keyResponse.body, ["success.key", "key", "data.key"]);
    if (!providerTransactionKey) {
      return rewardFailure(request, "PROMOTION_KEY_MISSING", "Promotion get-key response did not include key");
    }

    const executeResponse = await forwardJson(
      {
        method: "POST",
        path: TOSS_ENDPOINTS.promotionExecute,
        body: {
          promotionCode: config.tossPromotionCode,
          key: providerTransactionKey,
          amount: config.tossPromotionAmount,
        },
        tossUserKey,
      },
      config,
    );
    if (isUpstreamFailure(executeResponse.body)) {
      return rewardFailure(
        request,
        "PROMOTION_EXECUTE_FAILED",
        upstreamFailureReason(executeResponse.body),
        providerTransactionKey,
      );
    }
  }

  const resultResponse = await forwardJson(
    {
      method: "POST",
      path: TOSS_ENDPOINTS.promotionResult,
      body: { promotionCode: config.tossPromotionCode, key: providerTransactionKey },
      tossUserKey,
    },
    config,
  );
  if (isUpstreamFailure(resultResponse.body)) {
    return {
      ok: true,
      providerRequestId,
      providerStatus: "PENDING",
      providerTransactionKey,
      failureReason: `Promotion result lookup failed: ${upstreamFailureReason(resultResponse.body)}`,
    };
  }

  const providerStatus = normalizePromotionStatus(resultResponse.body);
  return {
    ok: true,
    providerRequestId,
    providerStatus,
    providerTransactionKey,
    grantedAt: providerStatus === "GRANTED" ? requestedAt : undefined,
    failureReason: providerStatus === "FAILED" ? upstreamFailureReason(resultResponse.body) : undefined,
  };
}

async function forwardJson(request, config) {
  if (!config.upstreamBaseUrl) {
    throw new Error("MTLS_UPSTREAM_BASE_URL is required in forward mode");
  }
  const target = new URL(request.path, config.upstreamBaseUrl);
  const payload = request.body === undefined ? undefined : Buffer.from(JSON.stringify(request.body));
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
    const upstream = transport.request(options, (upstreamRes) => {
      const chunks = [];
      upstreamRes.on("data", (chunk) => chunks.push(chunk));
      upstreamRes.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve({
          status: upstreamRes.statusCode || 500,
          headers: sanitizeResponseHeaders(upstreamRes.headers),
          body: parseMaybeJson(raw),
        });
      });
    });
    upstream.on("error", reject);
    if (payload) upstream.write(payload);
    upstream.end();
  });
}

function isAuthorized(req, config) {
  if (!config.internalToken) return true;
  return req.headers.authorization === `Bearer ${config.internalToken}`;
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(new Error(`Invalid JSON: ${error.message}`));
      }
    });
    req.on("error", reject);
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

function sanitizeHeaders(headers) {
  if (!headers || typeof headers !== "object" || Array.isArray(headers)) return {};
  const out = {};
  for (const [key, value] of Object.entries(headers)) {
    const name = key.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(name)) continue;
    if (value === undefined || value === null) continue;
    out[name] = String(value);
  }
  return out;
}

function sanitizeResponseHeaders(headers) {
  const out = {};
  for (const [key, value] of Object.entries(headers || {})) {
    const name = key.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(name) || name === "set-cookie") continue;
    out[name] = Array.isArray(value) ? value.join(",") : String(value);
  }
  return out;
}

function readRequiredFile(path, name) {
  if (!path) throw new Error(`${name} is required for HTTPS forward mode`);
  return readFileSync(path);
}

function parseMaybeJson(raw) {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return { raw };
  }
}

function stubLoginResponse(body) {
  const seed = `${body?.authorizationCode || ""}:${body?.referrer || ""}`;
  const digest = createHash("sha256").update(seed).digest("hex").slice(0, 24);
  return {
    ok: true,
    userKey: `stub-login:${digest}`,
    referrer: normalizeLoginReferrer(body?.referrer),
    scopes: ["user_key"],
    agreedTerms: [],
  };
}

function stubIapOrderStatus(body) {
  return {
    ok: true,
    orderId: String(body?.orderId || ""),
    sku: String(body?.sku || ""),
    providerStatus: "PAYMENT_COMPLETED",
    statusDeterminedAt: new Date(0).toISOString(),
    reason: "stub iap order status",
  };
}

function withoutTossUserKey(body) {
  if (!body || typeof body !== "object") return body;
  const { tossUserKey, ...rest } = body;
  return rest;
}

function normalizeLoginReferrer(value) {
  if (String(value || "").trim().toLowerCase() === "sandbox") {
    return "sandbox";
  }
  return "DEFAULT";
}

function normalizeScopes(value) {
  if (Array.isArray(value)) {
    return value.map((scope) => String(scope).trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(/[\s,]+/)
      .map((scope) => scope.trim())
      .filter(Boolean);
  }
  return ["user_key"];
}

function readPathString(value, paths) {
  const found = readPathValue(value, paths);
  if (found === undefined || found === null || found === "") return undefined;
  return String(found);
}

function readPathValue(value, paths) {
  for (const path of paths) {
    let current = value;
    let found = true;
    for (const segment of path.split(".")) {
      if (current && typeof current === "object" && segment in current) {
        current = current[segment];
      } else {
        found = false;
        break;
      }
    }
    if (found) return current;
  }
  return undefined;
}

function normalizeMessageResponse(request, upstream) {
  if (upstream?.providerStatus || upstream?.status) {
    return {
      ok: upstream.ok ?? true,
      providerRequestId: upstream.providerRequestId ?? request.providerRequestId,
      providerStatus: upstream.providerStatus ?? upstream.status,
      sentAt: upstream.sentAt,
      failureReason: upstream.failureReason ?? upstream.errorMessage ?? upstream.message,
    };
  }
  return {
    ok: true,
    providerRequestId: upstream?.providerRequestId ?? request.providerRequestId,
    providerStatus: "SENT",
    sentAt: upstream?.sentAt ?? request.requestedAt ?? Date.now(),
  };
}

function normalizeIapOrderStatusResponse(request, upstream) {
  if (isUpstreamFailure(upstream)) {
    return {
      ok: false,
      orderId: request?.orderId,
      providerStatus: "ERROR",
      failureReason: upstreamFailureReason(upstream),
    };
  }

  const order = objectOrSelf(readPathValue(upstream, ["success", "data", "result"]), upstream);

  const providerStatus = readPathString(order, ["status", "success.status", "data.status"]) || "ERROR";
  return {
    ok: true,
    orderId: readPathString(order, ["orderId", "success.orderId", "data.orderId"]) ?? request?.orderId,
    sku: readPathString(order, ["sku", "success.sku", "data.sku"]),
    providerStatus,
    statusDeterminedAt: readPathString(order, [
      "statusDeterminedAt",
      "success.statusDeterminedAt",
      "data.statusDeterminedAt",
    ]),
    reason: readPathString(order, ["reason", "success.reason", "data.reason"]),
  };
}

function objectOrSelf(value, fallback) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : fallback;
}

function rewardFailure(request, providerStatus, failureReason, providerTransactionKey = undefined) {
  return {
    ok: true,
    providerRequestId: request?.providerRequestId,
    providerStatus,
    providerTransactionKey,
    failureReason,
  };
}

function normalizePromotionStatus(value) {
  const status = String(
    readPathString(value, [
      "success.status",
      "status",
      "data.status",
      "resultType",
      "success.resultType",
      "data.resultType",
    ]) || "",
  ).toUpperCase();
  if (["SUCCESS", "SUCCEEDED", "GRANTED", "DONE", "COMPLETED"].includes(status)) return "GRANTED";
  if (["PENDING", "WAITING", "PROCESSING"].includes(status)) return "PENDING";
  return status ? "FAILED" : "GRANTED";
}

function isUpstreamFailure(value) {
  if (value?.ok === false) return true;
  const resultType = String(value?.resultType ?? "").trim().toUpperCase();
  return resultType === "FAIL" || resultType === "FAILED" || resultType === "ERROR";
}

function upstreamFailureReason(value) {
  return (
    readPathString(value, [
      "failureReason",
      "errorMessage",
      "message",
      "error.message",
      "error",
      "success.message",
      "data.message",
    ]) || "unknown upstream failure"
  );
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function numberOrUndefined(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function stringOrUndefined(value) {
  const trimmed = String(value ?? "").trim();
  return trimmed ? trimmed : undefined;
}
