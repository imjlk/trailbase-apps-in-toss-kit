import http from "node:http";
import { createTossMtlsCore, clientError, publicError as corePublicError, upstreamError } from "@ait-kit/api-core";
import { NodeMtlsTransportError } from "@ait-kit/api-client/node";
import { PROXY_ENDPOINTS } from "@ait-kit/api-client";
import { createConfig, requestBodyLimitBytes, validateConfig } from "./config.mjs";
import { createNodeMtlsClient } from "./node-mtls-client.mjs";
import { ANONYMOUS_KEY_VERIFY_PATH, requireAnonymousKey, verifyAnonymousKey } from "./anonymous-key.mjs";
import { proxyCapabilityMetadata } from "./capabilities.mjs";

const PAYABLE_IAP_STATUSES = new Set(["PAYMENT_COMPLETED", "PURCHASED"]);

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
    return response(200, { ok: health.ok, mode: health.mode, kit: proxyCapabilityMetadata() });
  }

  if (req.method === "POST" && url.pathname === ANONYMOUS_KEY_VERIFY_PATH) {
    const body = await readJson(req, requestBodyLimitBytes(config));
    return response(200, await verifyAnonymousKey(body, core, config.mode));
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
    // api-core 0.4 separates provider evidence (verified/skuCheck) from the
    // request expectation; the proxy keeps its legacy wire shape on top.
    return response(200, legacyIapResponse(await core.iapOrderStatus(body), config.mode));
  }

  if (req.method === "POST" && url.pathname === PROXY_ENDPOINTS.promotionRewardGrant) {
    // The batch grant route is removed: rewards must run the persisted
    // prepare -> execute -> status contract. This is an explicit
    // unsupported response — no core call, no upstream grant, no redirect.
    req.resume();
    return response(410, {
      ok: false,
      error: "PROMOTION_GRANT_REMOVED",
      message: "promotion/reward/grant was removed; use prepare, execute, and status",
    });
  }

  if (req.method === "POST" && url.pathname === PROXY_ENDPOINTS.promotionPrepareReward) {
    const body = await readJson(req, requestBodyLimitBytes(config));
    // api-core 0.5 binds the issued key to the caller's single recipient and
    // sends the matching identity header itself; a recipient-less prepare is
    // rejected before any dispatch. Prepare success means key issuance only.
    return response(200, await core.promotionPrepareReward(body));
  }

  if (req.method === "POST" && url.pathname === PROXY_ENDPOINTS.promotionExecuteReward) {
    const body = await readJson(req, requestBodyLimitBytes(config));
    const executed = await core.promotionExecuteReward(body);
    // Ledger callers using the prepare/execute flow must never persist or
    // log a provider-echoed recipient; every other path redacts, so the
    // direct execute route does too — for anonymous keys and Toss user
    // keys alike.
    const recipient = resolveRecipient(body);
    const result = recipient !== undefined ? redactRecipient(executed, recipient) : executed;
    return response(200, result);
  }

  if (req.method === "POST" && url.pathname === PROXY_ENDPOINTS.promotionRewardStatus) {
    const body = await readJson(req, requestBodyLimitBytes(config));
    return response(200, await promotionRewardStatus(core, body));
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
  // api-core 0.4 emits the official recipient headers (x-toss-user-key /
  // x-anon-key) itself, so the transport passes through unmodified.
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
    mtlsClient: createNodeMtlsClient(config),
  });
}

async function promotionRewardStatus(core, body) {
  const key = typeof body?.providerTransactionKey === "string" ? body.providerTransactionKey.trim() : "";
  if (!key) {
    throw clientError("MISSING_PROMOTION_TRANSACTION_KEY", "providerTransactionKey is required for result lookup");
  }
  const status = await core.promotionRewardStatus({ ...body, providerTransactionKey: key });
  // Result lookup only: the provider-observed status passes through
  // verbatim (UNKNOWN stays UNKNOWN; the Rust ledger owns the pending
  // classification), the caller's request id survives for correlation, and
  // provider-echoed recipients are redacted. This endpoint never allocates
  // a key or executes a grant.
  const providerRequestId = typeof body?.providerRequestId === "string" ? body.providerRequestId : undefined;
  const mapped = {
    ...status,
    ...(providerRequestId !== undefined && status.providerRequestId === undefined
      ? { providerRequestId }
      : {}),
  };
  const recipient = resolveRecipient(body);
  return recipient !== undefined ? redactRecipient(mapped, recipient) : mapped;
}

// Legacy IAP wire shape: keep the 0.2 response fields, drop the api-core
// verification internals, and enforce the proxy's paid-order policy
// (a paid order without provider SKU evidence is never payable here).
function legacyIapResponse(result, mode) {
  if (!result.ok) return result;
  const payable = PAYABLE_IAP_STATUSES.has(String(result.providerStatus).trim().toUpperCase());
  const skuMismatch = result.skuCheck?.status === "MISMATCHED";
  // The provider-SKU evidence requirement guards real upstream responses.
  // Stub mode fabricates payable results without provider evidence, and
  // the documented stub request shape does not require a SKU, so local
  // consumers keep the request-based stub behavior.
  const enforceProviderEvidence = mode !== "stub" && !result.stub;
  if (
    enforceProviderEvidence &&
    payable &&
    (!result.sku || skuMismatch || result.verificationCode === "ORDER_ID_MISMATCH")
  ) {
    return {
      ok: false,
      orderId: result.orderId,
      ...(result.sku !== undefined ? { sku: result.sku } : {}),
      providerStatus: "ERROR",
      error: "UNVERIFIED_IAP_ORDER",
      failureReason: result.verificationCode === "ORDER_ID_MISMATCH"
        ? "Toss order response named a different order ID"
        : skuMismatch
          ? "Toss order was paid for a different product than requested"
          : "Toss order response omitted the product SKU",
    };
  }
  const legacy = {
    ok: true,
    orderId: result.orderId,
    providerStatus: result.providerStatus,
  };
  if (result.sku !== undefined) legacy.sku = result.sku;
  if (result.statusDeterminedAt !== undefined) legacy.statusDeterminedAt = result.statusDeterminedAt;
  if (result.reason !== undefined) legacy.reason = result.reason;
  if (result.attempts !== undefined) legacy.attempts = result.attempts;
  return legacy;
}

// The documented recipient contract accepts anonKey or tossUserKey;
// provider-echoed identifiers of either kind must never reach downstream
// persistence or logs.
function resolveRecipient(body) {
  if (body?.anonKey !== undefined) return requireAnonymousKey(body.anonKey);
  if (typeof body?.tossUserKey === "string" && body.tossUserKey.trim()) {
    return body.tossUserKey.trim();
  }
  // userKey and integer tossUserKey are legal recipient spellings in the
  // shared contract; normalize them so provider-echo redaction still runs.
  if (body?.userKey !== undefined && body.userKey !== null) {
    return String(body.userKey);
  }
  if (typeof body?.tossUserKey === "number" && Number.isInteger(body.tossUserKey)) {
    return String(body.tossUserKey);
  }
  return undefined;
}

function redactRecipient(value, recipient) {
  if (typeof value === "string") return value.split(recipient).join("[redacted]");
  if (Array.isArray(value)) return value.map((entry) => redactRecipient(entry, recipient));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, redactRecipient(entry, recipient)]));
  return value;
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
  if (error instanceof NodeMtlsTransportError) {
    // Map the shared transport's failure codes onto the proxy's envelope.
    switch (error.code) {
      case "TIMEOUT":
        return { status: 504, code: "UPSTREAM_TIMEOUT", message: "Upstream request timed out" };
      case "RESPONSE_TOO_LARGE":
        return { status: 502, code: "UPSTREAM_RESPONSE_TOO_LARGE", message: "Upstream response was too large" };
      default:
        return { status: 502, code: "UPSTREAM_REQUEST_FAILED", message: "Upstream request failed" };
    }
  }
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
