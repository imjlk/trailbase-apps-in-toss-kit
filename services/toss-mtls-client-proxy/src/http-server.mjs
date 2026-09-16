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
    const body = await readJson(req, requestBodyLimitBytes(config));
    return response(200, await promotionReward(core, config, body));
  }

  if (req.method === "POST" && url.pathname === PROXY_ENDPOINTS.promotionPrepareReward) {
    const body = await readJson(req, requestBodyLimitBytes(config));
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

// Legacy grant wire shape. Non-anonymous grants pass through the unchanged
// core API; anonymous grants orchestrate the prepare -> execute ->
// status flow so every upstream call carries x-anon-key natively.
async function promotionReward(core, config, body) {
  if (body?.anonKey === undefined) return core.promotionRewardGrant(body);
  const anonKey = requireAnonymousKey(body.anonKey);
  if (body.tossUserKey !== undefined || body.userKey !== undefined) {
    throw clientError("INVALID_PROMOTION_RECIPIENT", "provide exactly one promotion recipient");
  }
  if (config.mode !== "forward") {
    // Stub mode keeps the deterministic legacy grant response; no transport
    // is consulted, so header mapping is irrelevant here.
    const stub = await core.promotionRewardGrant({ ...body, anonKey: undefined, tossUserKey: anonKey });
    return redactRecipient(stub, anonKey);
  }

  // A caller-supplied transaction key means a previous grant already
  // reached execute; retrying with prepare+execute would issue a second
  // reward. Route saved keys straight through the status lookup, matching
  // the previous grant implementation's existing-key path.
  const savedKey = typeof body?.providerTransactionKey === "string" ? body.providerTransactionKey.trim() : "";
  if (savedKey) {
    const status = await core.promotionRewardStatus({
      providerTransactionKey: savedKey,
      promotionCode: body.promotionCode,
      anonKey,
    });
    return redactRecipient(legacyGrantFromStatus(status, body), anonKey);
  }

  const prepared = await core.promotionPrepareReward({});
  if (!prepared.ok) {
    const providerRequestId =
      typeof body?.providerRequestId === "string" ? body.providerRequestId : undefined;
    return redactRecipient(
      {
        ...prepared,
        ...(providerRequestId !== undefined ? { providerRequestId } : {}),
      },
      anonKey,
    );
  }
  const executed = await core.promotionExecuteReward({
    providerTransactionKey: prepared.providerTransactionKey,
    promotionCode: body.promotionCode,
    amount: body.amount ?? body.promotionAmount,
    anonKey,
  });
  if (!executed.ok) {
    // Explicit provider rejection (e.g. 4112): no grant happened; surface
    // the legacy execute-failure shape with the provider's codes. The
    // caller's request ID survives for ledger/audit/retry correlation,
    // exactly as the previous grant implementation returned it.
    const providerRequestId =
      typeof body?.providerRequestId === "string" ? body.providerRequestId : undefined;
    return redactRecipient(
      {
        ok: false,
        ...(providerRequestId !== undefined ? { providerRequestId } : {}),
        providerStatus: "PROMOTION_EXECUTE_FAILED",
        providerTransactionKey: executed.providerTransactionKey,
        ...(executed.failureReason !== undefined ? { failureReason: executed.failureReason } : {}),
        ...(executed.providerErrorCode !== undefined
          ? { providerErrorCode: executed.providerErrorCode }
          : {}),
      },
      anonKey,
    );
  }
  // SUBMITTED or UNKNOWN: the grant may or may not have been applied — the
  // status lookup with the persisted transaction key decides the outcome,
  // exactly the recovery path ledger callers use after a lost response.
  const status = await core.promotionRewardStatus({
    providerTransactionKey: prepared.providerTransactionKey,
    promotionCode: body.promotionCode,
    anonKey,
  });
  return redactRecipient(legacyGrantFromStatus(status, body), anonKey);
}

function legacyGrantFromStatus(status, request) {
  const providerRequestId = typeof request?.providerRequestId === "string" ? request.providerRequestId : undefined;
  if (!status.ok) {
    return {
      ok: false,
      ...(providerRequestId !== undefined ? { providerRequestId } : {}),
      providerStatus: "FAILED",
      providerTransactionKey: status.providerTransactionKey,
      failureReason: status.failureReason ?? "promotion status could not be determined",
      ...(status.providerErrorCode !== undefined ? { providerErrorCode: status.providerErrorCode } : {}),
    };
  }
  const providerStatus = status.status === "UNKNOWN" ? "PENDING" : status.status;
  return {
    ok: providerStatus !== "FAILED",
    ...(providerRequestId !== undefined ? { providerRequestId } : {}),
    providerStatus,
    providerTransactionKey: status.providerTransactionKey,
    // The old grant response surfaced the caller's requestedAt as the
    // provider grant timestamp on success; keep it for ledger persistence.
    ...(providerStatus === "GRANTED" && typeof request?.requestedAt === "number"
      ? { grantedAt: request.requestedAt }
      : {}),
    ...(status.failureReason !== undefined ? { failureReason: status.failureReason } : {}),
    ...(status.providerErrorCode !== undefined ? { providerErrorCode: status.providerErrorCode } : {}),
  };
}

async function promotionRewardStatus(core, body) {
  const key = typeof body?.providerTransactionKey === "string" ? body.providerTransactionKey.trim() : "";
  if (!key) {
    throw clientError("MISSING_PROMOTION_TRANSACTION_KEY", "providerTransactionKey is required for result lookup");
  }
  const status = await core.promotionRewardStatus({ ...body, providerTransactionKey: key });
  // Anonymous recipients must never leak back through provider-echoed
  // failure fields; the old grant-based path redacted, so this does too.
  if (!status.ok) {
    const providerRequestId =
      typeof body?.providerRequestId === "string" ? body.providerRequestId : undefined;
    const withRequestId = {
      ...status,
      ...(providerRequestId !== undefined ? { providerRequestId } : {}),
    };
    const recipient = resolveRecipient(body);
    return recipient !== undefined ? redactRecipient(withRequestId, recipient) : withRequestId;
  }
  // Legacy ledger consumers classify anything besides GRANTED/PENDING as
  // failed, so an indeterminate (UNKNOWN) outcome must stay PENDING here —
  // never finalized as failed while the grant may still land.
  const providerStatus = status.status === "UNKNOWN" ? "PENDING" : status.status;
  const providerRequestId = typeof body?.providerRequestId === "string" ? body.providerRequestId : undefined;
  const mapped = {
    // A technically successful lookup can still report a terminal FAILED
    // outcome; the previous status path returned ok:false for it, and
    // ledger consumers key their failure handling off this field.
    ok: providerStatus !== "FAILED",
    ...(providerRequestId !== undefined ? { providerRequestId } : {}),
    providerStatus,
    status: status.status,
    providerTransactionKey: status.providerTransactionKey,
    checkedAt: status.checkedAt,
    ...(status.failureReason !== undefined ? { failureReason: status.failureReason } : {}),
    ...(status.providerErrorCode !== undefined ? { providerErrorCode: status.providerErrorCode } : {}),
  };
  const mappedRecipient = resolveRecipient(body);
  return mappedRecipient !== undefined ? redactRecipient(mapped, mappedRecipient) : mapped;
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
