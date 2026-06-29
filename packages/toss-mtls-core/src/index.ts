export const SMART_MESSAGE_BULK_MAX_CONTEXTS = 2_500;
export const DEFAULT_IAP_ORDER_STATUS_MAX_ATTEMPTS = 6;
export const DEFAULT_IAP_ORDER_STATUS_RETRY_DELAY_MS = 350;

export const TOSS_ENDPOINTS = Object.freeze({
  loginGenerateToken: "/api-partner/v1/apps-in-toss/user/oauth2/generate-token",
  loginMe: "/api-partner/v1/apps-in-toss/user/oauth2/login-me",
  loginRemoveByUserKey: "/api-partner/v1/apps-in-toss/user/oauth2/access/remove-by-user-key",
  promotionGetKey: "/api-partner/v1/apps-in-toss/promotion/execute-promotion/get-key",
  promotionExecute: "/api-partner/v1/apps-in-toss/promotion/execute-promotion",
  promotionResult: "/api-partner/v1/apps-in-toss/promotion/execution-result",
  iapOrderStatus: "/api-partner/v1/apps-in-toss/order/get-order-status",
  messageSend: "/api-partner/v1/apps-in-toss/messenger/send-message",
  messageBulkSend: "/api-partner/v1/apps-in-toss/messenger/send-bulk-message",
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

const RETRYABLE_IAP_ORDER_STATUSES = new Set([
  "NOT_FOUND",
  "ORDER_IN_PROGRESS",
  "PAYMENT_PENDING",
  "PENDING",
  "PROCESSING",
]);

export type TossMtlsMode = "stub" | "forward";
export type JsonObject = Record<string, unknown>;

interface TossMtlsRequest {
  method: string;
  path: string;
  headers?: Record<string, string>;
  body?: unknown;
  tossUserKey?: string;
}

interface TossMtlsResponse {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

export interface MtlsClient {
  request(url: string, init: RequestInit): Promise<Response>;
}

export interface MtlsClientFactory {
  forApp(appId: string): Promise<MtlsClient>;
}

export interface TossMtlsCoreOptions {
  mode?: TossMtlsMode | string;
  upstreamBaseUrl?: string;
  mtlsClient?: MtlsClient;
  mtlsClientFactory?: MtlsClientFactory;
  appId?: string;
  tossPromotionCode?: string;
  tossPromotionAmount?: number;
  iapOrderStatusMaxAttempts?: number;
  iapOrderStatusRetryDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  debug?: boolean;
  log?: (message: string, fields?: Record<string, unknown>) => void;
}

export interface TossMtlsCore {
  health(): Promise<{ ok: true; mode: TossMtlsMode }>;
  genericMtlsRequest(body: unknown): Promise<unknown>;
  tossLoginComplete(body: unknown): Promise<unknown>;
  tossLoginRemoveByUserKey(body: unknown): Promise<unknown>;
  iapOrderStatus(body: unknown): Promise<unknown>;
  promotionRewardGrant(body: unknown): Promise<unknown>;
  smartMessageSend(body: unknown): Promise<unknown>;
  smartMessageBulkSend(body: unknown): Promise<unknown>;
}

interface NormalizedCoreOptions extends TossMtlsCoreOptions {
  mode: TossMtlsMode;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

export function createTossMtlsCore(options: TossMtlsCoreOptions = {}): TossMtlsCore {
  const coreOptions = normalizeCoreOptions(options);
  return {
    health: async () => ({ ok: true, mode: coreOptions.mode }),
    genericMtlsRequest: (body) => handleGenericMtlRequest(body, coreOptions),
    tossLoginComplete: (body) =>
      coreOptions.mode === "forward" ? completeTossLogin(body, coreOptions) : stubLoginResponse(body),
    tossLoginRemoveByUserKey: (body) =>
      coreOptions.mode === "forward" ? removeTossLoginByUserKey(body, coreOptions) : stubLoginRemoveByUserKey(body),
    iapOrderStatus: (body) =>
      coreOptions.mode === "forward" ? getIapOrderStatus(body, coreOptions) : Promise.resolve(stubIapOrderStatus(body)),
    promotionRewardGrant: (body) =>
      coreOptions.mode === "forward"
        ? grantPromotionReward(body, coreOptions)
        : Promise.resolve({
            ok: true,
            providerRequestId: objectOrSelf(body, {})?.providerRequestId,
            providerStatus: "GRANTED",
            grantedAt: objectOrSelf(body, {})?.requestedAt ?? coreOptions.now(),
            providerTransactionKey: objectOrSelf(body, {})?.providerTransactionKey,
          }),
    smartMessageSend: async (body) => {
      if (coreOptions.mode !== "forward") {
        return stubSmartMessageResponse(body, 1, coreOptions.now);
      }
      const request = objectOrSelf(body, {});
      const upstream = await requestTransport(
        {
          method: "POST",
          path: TOSS_ENDPOINTS.messageSend,
          body: messageUpstreamBody(request),
          tossUserKey: stringOrUndefined(request.tossUserKey),
        },
        coreOptions,
      );
      return normalizeMessageResponse(request, upstream.body, upstream.status, coreOptions.now);
    },
    smartMessageBulkSend: async (body) => {
      const request = objectOrSelf(body, {});
      const upstreamBody = bulkMessageUpstreamBody(request);
      if (coreOptions.mode !== "forward") {
        return stubSmartMessageResponse(request, upstreamBody.contextList.length, coreOptions.now);
      }
      const upstream = await requestTransport(
        {
          method: "POST",
          path: TOSS_ENDPOINTS.messageBulkSend,
          body: upstreamBody,
        },
        coreOptions,
      );
      return normalizeMessageResponse(request, upstream.body, upstream.status, coreOptions.now);
    },
  };
}

function normalizeCoreOptions(options: TossMtlsCoreOptions): NormalizedCoreOptions {
  const mode = String(options.mode || "stub").trim().toLowerCase();
  if (mode !== "stub" && mode !== "forward") {
    throw configError("INVALID_MTLS_PROXY_MODE", "MTLS_PROXY_MODE must be stub or forward");
  }
  return {
    ...options,
    mode,
    sleep: options.sleep || defaultSleep,
    now: options.now || Date.now,
  };
}

export async function handleGenericMtlRequest(body: unknown, options: TossMtlsCoreOptions = {}) {
  const coreOptions = normalizeCoreOptions(options);
  const request = normalizeGenericRequest(body);
  const upstream = await requestTransport(request, coreOptions);
  return {
    ok: upstream.status >= 200 && upstream.status < 300,
    status: upstream.status,
    headers: upstream.headers || {},
    body: upstream.body,
  };
}

export function normalizeGenericRequest(body: unknown): TossMtlsRequest {
  const request = objectOrSelf(body, {});
  const method = String(request.method || "POST").trim().toUpperCase();
  if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    throw clientError("UNSUPPORTED_METHOD", "Unsupported method");
  }
  const path = String(request.path || "").trim();
  if (!path.startsWith("/") || path.startsWith("//") || /^https?:\/\//i.test(path)) {
    throw clientError("INVALID_PROXY_PATH", "path must be a relative absolute path");
  }
  return {
    method,
    path,
    headers: sanitizeHeaders(objectOrUndefined(request.headers)),
    body: request.body,
    tossUserKey: stringOrUndefined(request.tossUserKey),
  };
}

async function completeTossLogin(body: unknown, options: NormalizedCoreOptions) {
  const request = objectOrSelf(body, {});
  const authorizationCode = String(request.authorizationCode || request.authorization_code || "").trim();
  if (!authorizationCode) {
    return { ok: false, error: "MISSING_AUTHORIZATION_CODE" };
  }

  const referrer = normalizeLoginReferrer(request.referrer);
  const tokenResponse = await requestTransport(
    {
      method: "POST",
      path: TOSS_ENDPOINTS.loginGenerateToken,
      body: { authorizationCode, referrer },
    },
    options,
  );
  if (isUpstreamFailure(tokenResponse.body)) {
    debugLog(options, "toss login token exchange failed", {
      status: tokenResponse.status,
      errorCode: readPathString(tokenResponse.body, ["error.errorCode", "errorCode"]),
      failureReason: upstreamFailureReason(tokenResponse.body),
    });
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

  const userResponse = await requestTransport(
    {
      method: "GET",
      path: TOSS_ENDPOINTS.loginMe,
      headers: { authorization: bearerAuthorization(accessToken) },
    },
    options,
  );
  if (isUpstreamFailure(userResponse.body)) {
    debugLog(options, "toss login user lookup failed", {
      status: userResponse.status,
      errorCode: readPathString(userResponse.body, ["error.errorCode", "errorCode"]),
      failureReason: upstreamFailureReason(userResponse.body),
    });
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
      readPathValue(userResponse.body, [
        "success.scope",
        "scope",
        "data.scope",
        "success.scopes",
        "scopes",
        "data.scopes",
      ]) ??
        readPathValue(tokenResponse.body, [
          "success.scope",
          "scope",
          "data.scope",
          "success.scopes",
          "scopes",
          "data.scopes",
        ]),
    ),
    agreedTerms: readPathValue(userResponse.body, ["success.agreedTerms", "agreedTerms", "data.agreedTerms"]) ?? [],
    accessToken,
    refreshToken: readPathString(tokenResponse.body, [
      "success.refreshToken",
      "refreshToken",
      "data.refreshToken",
      "success.refresh_token",
      "refresh_token",
      "data.refresh_token",
    ]),
    tokenType: readPathString(tokenResponse.body, [
      "success.tokenType",
      "tokenType",
      "data.tokenType",
      "success.token_type",
      "token_type",
      "data.token_type",
    ]),
    expiresIn: readPathValue(tokenResponse.body, [
      "success.expiresIn",
      "expiresIn",
      "data.expiresIn",
      "success.expires_in",
      "expires_in",
      "data.expires_in",
    ]),
  };
}

async function getIapOrderStatus(requestBody: unknown, options: NormalizedCoreOptions) {
  const request = objectOrSelf(requestBody, {});
  const orderId = stringOrUndefined(request.orderId);
  const tossUserKey = stringOrUndefined(request.tossUserKey);
  if (!orderId) {
    return { ok: false, error: "MISSING_ORDER_ID", providerStatus: "ERROR" };
  }
  if (!tossUserKey) {
    return { ok: false, error: "MISSING_TOSS_USER_KEY", providerStatus: "ERROR" };
  }

  const maxAttempts = iapOrderStatusMaxAttempts(options);
  const retryDelayMs = iapOrderStatusRetryDelayMs(options);
  let normalized;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const upstream = await requestTransport(
      {
        method: "POST",
        path: TOSS_ENDPOINTS.iapOrderStatus,
        body: { orderId },
        tossUserKey,
      },
      options,
    );
    normalized = normalizeIapOrderStatusResponse(request, upstream.body);
    if (!isRetryableIapOrderStatus(normalized) || attempt >= maxAttempts) {
      return attempt > 1 ? { ...normalized, attempts: attempt } : normalized;
    }
    debugLog(options, "retrying transient iap order status", {
      orderId,
      providerStatus: normalized.providerStatus,
      attempt,
    });
    if (retryDelayMs > 0) {
      await options.sleep(retryDelayMs);
    }
  }
  return normalized;
}

async function removeTossLoginByUserKey(requestBody: unknown, options: NormalizedCoreOptions) {
  const request = objectOrSelf(requestBody, {});
  const tossUserKey = unlinkTossUserKey(request);
  if (!tossUserKey) {
    return { ok: false, error: "MISSING_TOSS_USER_KEY", providerStatus: "ERROR" };
  }
  const accessToken = tossLoginAccessToken(request);
  if (!accessToken) {
    return { ok: false, error: "MISSING_TOSS_ACCESS_TOKEN", providerStatus: "ERROR" };
  }

  const upstream = await requestTransport(
    {
      method: "POST",
      path: TOSS_ENDPOINTS.loginRemoveByUserKey,
      headers: { authorization: bearerAuthorization(accessToken) },
      body: { userKey: tossUserKey },
      tossUserKey,
    },
    options,
  );
  return normalizeTossLoginRemoveByUserKeyResponse(upstream.body, upstream.status, [tossUserKey, accessToken]);
}

async function grantPromotionReward(requestBody: unknown, options: NormalizedCoreOptions) {
  const request = objectOrSelf(requestBody, {});
  const providerRequestId = stringOrUndefined(request.providerRequestId);
  const requestedAt = numberOrUndefined(request.requestedAt) ?? options.now();
  const tossUserKey = stringOrUndefined(request.tossUserKey);
  const promotionCode = stringOrUndefined(request.promotionCode) || options.tossPromotionCode;
  const promotionAmount =
    positiveIntegerOrUndefined(request.amount) ||
    positiveIntegerOrUndefined(request.promotionAmount) ||
    options.tossPromotionAmount;
  if (!tossUserKey) {
    return rewardFailure(request, "MISSING_TOSS_USER_KEY", "tossUserKey is required for promotion grant");
  }
  if (!promotionCode) {
    return rewardFailure(request, "MISSING_TOSS_PROMOTION_CODE", "promotionCode or TOSS_PROMOTION_CODE is required");
  }

  let providerTransactionKey = stringOrUndefined(request.providerTransactionKey);
  if (!providerTransactionKey) {
    const keyResponse = await requestTransport(
      { method: "POST", path: TOSS_ENDPOINTS.promotionGetKey, body: {}, tossUserKey },
      options,
    );
    if (isUpstreamFailure(keyResponse.body)) {
      return rewardFailure(request, "PROMOTION_KEY_FAILED", upstreamFailureReason(keyResponse.body));
    }
    providerTransactionKey = readPathString(keyResponse.body, ["success.key", "key", "data.key"]);
    if (!providerTransactionKey) {
      return rewardFailure(request, "PROMOTION_KEY_MISSING", "Promotion get-key response did not include key");
    }

    const executeResponse = await requestTransport(
      {
        method: "POST",
        path: TOSS_ENDPOINTS.promotionExecute,
        body: {
          promotionCode,
          key: providerTransactionKey,
          amount: promotionAmount,
        },
        tossUserKey,
      },
      options,
    );
    const executeErrorCode = upstreamFailureCode(executeResponse.body);
    if (isUpstreamFailure(executeResponse.body)) {
      return rewardFailure(
        request,
        "PROMOTION_EXECUTE_FAILED",
        upstreamFailureReason(executeResponse.body),
        providerTransactionKey,
        executeErrorCode,
      );
    }
  }

  const resultResponse = await requestTransport(
    {
      method: "POST",
      path: TOSS_ENDPOINTS.promotionResult,
      body: { promotionCode, key: providerTransactionKey },
      tossUserKey,
    },
    options,
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

async function requestTransport(request: TossMtlsRequest, options: NormalizedCoreOptions): Promise<TossMtlsResponse> {
  const client = await resolveMtlsClient(options);
  const url = resolveMtlsUrl(request.path, options);
  const headers: Record<string, string> = {
    accept: "application/json",
    ...sanitizeHeaders(request.headers),
  };
  const init: RequestInit = {
    method: request.method,
    headers,
  };
  if (request.body !== undefined) {
    headers["content-type"] = headers["content-type"] || "application/json";
    init.body = JSON.stringify(request.body);
  }
  if (request.tossUserKey) {
    headers["x-toss-user-key"] = request.tossUserKey;
  }

  const response = await client.request(url, init);
  const raw = await response.text();
  return {
    status: response.status,
    headers: sanitizeResponseHeaders(responseHeadersObject(response.headers)),
    body: parseMaybeJson(raw),
  };
}

async function resolveMtlsClient(options: NormalizedCoreOptions) {
  if (options.mtlsClient) {
    return options.mtlsClient;
  }
  if (!options.mtlsClientFactory) {
    throw configError("MISSING_MTLS_CLIENT", "mTLS client is required in forward mode");
  }
  const appId = stringOrUndefined(options.appId);
  if (!appId) {
    throw configError("MISSING_MTLS_APP_ID", "appId is required when mtlsClientFactory is used");
  }
  return await options.mtlsClientFactory.forApp(appId);
}

function resolveMtlsUrl(path: string, options: NormalizedCoreOptions) {
  const baseUrl = stringOrUndefined(options.upstreamBaseUrl);
  if (!baseUrl) {
    throw configError("MISSING_MTLS_UPSTREAM_BASE_URL", "MTLS_UPSTREAM_BASE_URL is required in forward mode");
  }
  return new URL(path, baseUrl).toString();
}

function responseHeadersObject(headers: Headers) {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

export function sanitizeHeaders(headers: Record<string, unknown> | undefined): Record<string, string> {
  if (!headers || typeof headers !== "object" || Array.isArray(headers)) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    const name = key.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(name)) continue;
    if (value === undefined || value === null) continue;
    out[name] = String(value);
  }
  return out;
}

export function sanitizeResponseHeaders(headers: Record<string, unknown> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers || {})) {
    const name = key.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(name) || name === "set-cookie") continue;
    out[name] = Array.isArray(value) ? value.join(",") : String(value);
  }
  return out;
}

export function parseMaybeJson(raw: string) {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return { raw };
  }
}

async function stubLoginResponse(body: unknown) {
  const request = objectOrSelf(body, {});
  const seed = `${request.authorizationCode || ""}:${request.referrer || ""}`;
  const digest = await sha256Hex(seed);
  return {
    ok: true,
    userKey: `stub-login:${digest.slice(0, 24)}`,
    referrer: normalizeLoginReferrer(request.referrer),
    scopes: ["user_key"],
    agreedTerms: [],
  };
}

function stubIapOrderStatus(body: unknown) {
  const request = objectOrSelf(body, {});
  return {
    ok: true,
    orderId: String(request.orderId || ""),
    sku: String(request.sku || ""),
    providerStatus: "PAYMENT_COMPLETED",
    statusDeterminedAt: new Date(0).toISOString(),
    reason: "stub iap order status",
  };
}

function stubLoginRemoveByUserKey(body: unknown) {
  if (!unlinkTossUserKey(objectOrSelf(body, {}))) {
    return { ok: false, error: "MISSING_TOSS_USER_KEY", providerStatus: "ERROR" };
  }
  return {
    ok: true,
    providerStatus: "REMOVED",
    resultType: "SUCCESS",
  };
}

function stubSmartMessageResponse(body: unknown, msgCount: number, now: () => number) {
  const request = objectOrSelf(body, {});
  return {
    ok: true,
    providerRequestId: request.providerRequestId,
    providerStatus: "SENT",
    resultType: "SUCCESS",
    sentAt: request.requestedAt ?? now(),
    msgCount,
    sentPushCount: msgCount,
    sentInboxCount: 0,
  };
}

export function messageUpstreamBody(body: Record<string, unknown>) {
  const templateSetCode = stringOrUndefined(body.templateSetCode);
  if (!templateSetCode) {
    throw clientError("MISSING_TEMPLATE_SET_CODE", "templateSetCode is required");
  }
  return {
    templateSetCode,
    context: messageContext(body.context, "context"),
  };
}

export function bulkMessageUpstreamBody(body: Record<string, unknown>) {
  const templateSetCode = stringOrUndefined(body.templateSetCode);
  if (!templateSetCode) {
    throw clientError("MISSING_TEMPLATE_SET_CODE", "templateSetCode is required");
  }
  if (!Array.isArray(body.contextList)) {
    throw clientError("INVALID_CONTEXT_LIST", "contextList must be an array");
  }
  if (body.contextList.length < 1) {
    throw clientError("EMPTY_CONTEXT_LIST", "contextList must include at least one recipient");
  }
  if (body.contextList.length > SMART_MESSAGE_BULK_MAX_CONTEXTS) {
    throw clientError("CONTEXT_LIST_TOO_LARGE", "contextList supports at most 2500 recipients", 413);
  }
  return {
    templateSetCode,
    contextList: body.contextList.map((entry, index) => {
      const item = objectOrSelf(entry, {});
      const userKey = stringOrUndefined(item.userKey ?? item.tossUserKey);
      if (!userKey) {
        throw clientError("MISSING_CONTEXT_USER_KEY", `contextList[${index}].userKey is required`);
      }
      return {
        userKey,
        context: messageContext(item.context, `contextList[${index}].context`),
      };
    }),
  };
}

function messageContext(value: unknown, name: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw clientError("INVALID_MESSAGE_CONTEXT", `${name} must be an object`);
  }
  return value;
}

export function normalizeLoginReferrer(value: unknown) {
  const referrer = String(value || "").trim();
  if (referrer.toLowerCase() === "sandbox") {
    return referrer;
  }
  return "DEFAULT";
}

export function normalizeScopes(value: unknown) {
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

function unlinkTossUserKey(value: Record<string, unknown>) {
  return stringOrUndefined(value.tossUserKey ?? value.userKey ?? value.user_key);
}

function tossLoginAccessToken(value: Record<string, unknown>) {
  return bearerTokenValue(value.accessToken ?? value.tossAccessToken ?? value.tossLoginAccessToken ?? value.access_token);
}

function bearerAuthorization(accessToken: unknown) {
  const token = bearerTokenValue(accessToken);
  if (!token) return "";
  return `Bearer ${token}`;
}

function bearerTokenValue(value: unknown) {
  const token = stringOrUndefined(value);
  if (!token) return "";
  const match = token.match(/^Bearer\s+(.+)$/i);
  return stringOrUndefined(match ? match[1] : token) || "";
}

function readPathString(value: unknown, paths: string[]) {
  const found = readPathValue(value, paths);
  if (found === undefined || found === null || found === "") return undefined;
  return String(found);
}

function readPathValue(value: unknown, paths: string[]) {
  for (const path of paths) {
    let current = value as Record<string, unknown>;
    let found = true;
    for (const segment of path.split(".")) {
      if (current && typeof current === "object" && segment in current) {
        current = current[segment] as Record<string, unknown>;
      } else {
        found = false;
        break;
      }
    }
    if (found) return current;
  }
  return undefined;
}

export function normalizeTossLoginRemoveByUserKeyResponse(
  upstream: unknown,
  upstreamStatus = 200,
  sensitiveValues: unknown[] = [],
) {
  const resultType = readPathString(upstream, ["resultType", "success.resultType", "data.resultType"]);
  if (
    !httpStatusOk(upstreamStatus) ||
    isUpstreamFailure(upstream) ||
    hasTopLevelUpstreamError(upstream) ||
    hasTopLevelUpstreamErrorCode(upstream)
  ) {
    return {
      ok: false,
      providerStatus: "FAILED",
      resultType,
      failureReason: redactSensitiveValues(upstreamFailureReason(upstream), sensitiveValues),
      providerErrorCode: upstreamFailureCode(upstream),
      upstreamStatus,
    };
  }
  return {
    ok: true,
    providerStatus: "REMOVED",
    resultType: resultType ?? "SUCCESS",
  };
}

export function normalizeMessageResponse(
  requestBody: Record<string, unknown>,
  upstream: unknown,
  upstreamStatus = 200,
  now: () => number = Date.now,
) {
  const upstreamObject = objectOrSelf(upstream, {});
  const resultType = readPathString(upstreamObject, ["resultType", "success.resultType", "data.resultType"]);
  const providerRequestId =
    readPathString(upstreamObject, ["providerRequestId", "requestId", "result.providerRequestId"]) ??
    requestBody.providerRequestId;
  const sentAt = upstreamObject.sentAt ?? requestBody.requestedAt ?? now();

  if (!httpStatusOk(upstreamStatus)) {
    return {
      ok: false,
      providerRequestId,
      providerStatus: "FAILED",
      resultType,
      sentAt,
      failureReason: upstreamFailureReason(upstreamObject),
      providerErrorCode: upstreamFailureCode(upstreamObject),
      upstreamStatus,
    };
  }

  if (upstreamObject.providerStatus || (upstreamObject.status && !upstreamObject.resultType && !upstreamObject.result)) {
    const providerStatus = upstreamObject.providerStatus ?? upstreamObject.status;
    return {
      ok: upstreamObject.ok ?? messageStatusOk(providerStatus),
      providerRequestId: upstreamObject.providerRequestId ?? requestBody.providerRequestId,
      providerStatus,
      sentAt: upstreamObject.sentAt,
      failureReason: upstreamObject.failureReason ?? upstreamObject.errorMessage ?? upstreamObject.message,
    };
  }
  const result = objectOrSelf(
    readPathValue(upstreamObject, ["result", "success.result", "success", "data.result", "data.success"]),
    {},
  );

  if (isUpstreamFailure(upstreamObject)) {
    return {
      ok: false,
      providerRequestId,
      providerStatus: "FAILED",
      resultType,
      sentAt,
      failureReason: upstreamFailureReason(upstreamObject),
      providerErrorCode: upstreamFailureCode(upstreamObject),
    };
  }

  const msgCount = nonNegativeIntegerOrUndefined(readPathValue(result, ["msgCount"]));
  const sentPushCount = nonNegativeIntegerOrUndefined(readPathValue(result, ["sentPushCount"]));
  const sentInboxCount = nonNegativeIntegerOrUndefined(readPathValue(result, ["sentInboxCount"]));
  const failures = collectMessageFailures(result);
  const contentIds = collectMessageContentIds(objectOrSelf(result, {}).detail);
  const sentCount = [msgCount, sentPushCount, sentInboxCount]
    .filter((value) => value !== undefined)
    .reduce((a, b) => Number(a) + Number(b), 0);
  const failureReason = firstMessageFailureReason(failures);
  const providerStatus = sentCount > 0 || failures.length === 0 ? "SENT" : "FAILED";

  return {
    ok: providerStatus === "SENT",
    providerRequestId,
    providerStatus,
    resultType,
    sentAt,
    failureReason,
    msgCount: msgCount ?? (sentCount > 0 ? sentCount : undefined),
    sentPushCount,
    sentInboxCount,
    detail: objectOrSelf(result, {}).detail,
    fail: objectOrSelf(result, {}).fail,
    failures: failures.length > 0 ? failures : undefined,
    contentIds: contentIds.length > 0 ? contentIds : undefined,
  };
}

const MESSAGE_RESULT_CHANNELS = ["sentPush", "sentInbox", "sentSms", "sentAlimtalk", "sentFriendtalk"];

function collectMessageFailures(result: unknown) {
  const failures = [];
  const fail = objectOrSelf(objectOrSelf(result, {}).fail, {});
  for (const channel of MESSAGE_RESULT_CHANNELS) {
    const entries = Array.isArray(fail[channel]) ? fail[channel] : [];
    for (const entry of entries) {
      if (!entry || typeof entry !== "object") continue;
      failures.push({
        channel,
        contentId: readPathString(entry, ["contentId", "id"]),
        reachFailReason: readPathString(entry, ["reachFailReason", "reason", "message", "errorMessage"]),
      });
    }
  }
  return failures;
}

function collectMessageContentIds(detail: unknown) {
  const contentIds = [];
  const detailObject = objectOrSelf(detail, {});
  for (const channel of MESSAGE_RESULT_CHANNELS) {
    const entries = Array.isArray(detailObject[channel]) ? detailObject[channel] : [];
    for (const entry of entries) {
      const contentId = readPathString(entry, ["contentId", "id"]);
      if (contentId) contentIds.push(contentId);
    }
  }
  return contentIds;
}

function firstMessageFailureReason(failures: Array<{ reachFailReason?: string }>) {
  for (const failure of failures) {
    if (failure.reachFailReason) return failure.reachFailReason;
  }
  return undefined;
}

function messageStatusOk(status: unknown) {
  const normalized = String(status ?? "").trim().toUpperCase();
  return !["FAILED", "FAIL", "ERROR", "REJECTED"].includes(normalized);
}

function httpStatusOk(status: unknown) {
  return Number.isInteger(status) && Number(status) >= 200 && Number(status) < 300;
}

export function normalizeIapOrderStatusResponse(requestBody: unknown, upstream: unknown) {
  const request = objectOrSelf(requestBody, {});
  if (isUpstreamFailure(upstream)) {
    return {
      ok: false,
      orderId: request.orderId,
      providerStatus: "ERROR",
      failureReason: upstreamFailureReason(upstream),
    };
  }

  const order = objectOrSelf(readPathValue(upstream, ["success", "data", "result"]), upstream);

  const providerStatus = readPathString(order, ["status", "success.status", "data.status"]) || "ERROR";
  return {
    ok: true,
    orderId: readPathString(order, ["orderId", "success.orderId", "data.orderId"]) ?? request.orderId,
    sku: readPathString(order, ["sku", "success.sku", "data.sku"]) ?? stringOrUndefined(request.sku),
    providerStatus,
    statusDeterminedAt: readPathString(order, [
      "statusDeterminedAt",
      "success.statusDeterminedAt",
      "data.statusDeterminedAt",
    ]),
    reason: readPathString(order, ["reason", "success.reason", "data.reason"]),
  };
}

function objectOrSelf(value: unknown, fallback: Record<string, unknown> = {}): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : fallback;
}

function objectOrUndefined(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function rewardFailure(
  request: Record<string, unknown>,
  providerStatus: string,
  failureReason: string,
  providerTransactionKey = undefined,
  providerErrorCode = undefined,
) {
  return {
    ok: true,
    providerRequestId: request.providerRequestId,
    providerStatus,
    providerTransactionKey,
    providerErrorCode,
    failureReason,
  };
}

function normalizePromotionStatus(value: unknown) {
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

function isUpstreamFailure(value: unknown) {
  const object = objectOrSelf(value, {});
  if (object.ok === false) return true;
  const resultType = String(object.resultType ?? "").trim().toUpperCase();
  return resultType === "FAIL" || resultType === "FAILED" || resultType === "ERROR";
}

function hasTopLevelUpstreamError(value: unknown) {
  if (!value || typeof value !== "object" || !Object.hasOwn(value, "error")) {
    return false;
  }
  const error = (value as Record<string, unknown>).error;
  if (error === undefined || error === null || error === "") {
    return false;
  }
  return typeof error !== "object" || Object.keys(error).length > 0;
}

function hasTopLevelUpstreamErrorCode(value: unknown) {
  return Boolean(
    value &&
      typeof value === "object" &&
      Object.hasOwn(value, "errorCode") &&
      stringOrUndefined((value as Record<string, unknown>).errorCode),
  );
}

function upstreamFailureReason(value: unknown) {
  return (
    readPathString(value, [
      "failureReason",
      "errorMessage",
      "message",
      "error.reason",
      "error.errorMessage",
      "error.errorCode",
      "error.message",
      "error",
      "success.message",
      "success.reason",
      "data.reason",
      "data.message",
      "raw",
    ]) || "unknown upstream failure"
  );
}

function upstreamFailureCode(value: unknown) {
  return readPathString(value, [
    "providerErrorCode",
    "errorCode",
    "code",
    "error.errorCode",
    "error.code",
    "success.errorCode",
    "data.errorCode",
    "data.code",
  ]);
}

function redactSensitiveValue(value: unknown, sensitive: unknown) {
  if (value === undefined || value === null) {
    return value;
  }
  const secret = String(sensitive || "");
  if (!secret) {
    return String(value);
  }
  return String(value).split(secret).join("[redacted]");
}

function redactSensitiveValues(value: unknown, sensitiveValues: unknown[]) {
  const values = Array.isArray(sensitiveValues) ? sensitiveValues : [sensitiveValues];
  return values.reduce((current, sensitive) => redactSensitiveValue(current, sensitive), value);
}

export function parsePositiveInteger(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function parseNonNegativeInteger(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

export function positiveIntegerOrUndefined(value: unknown) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export function nonNegativeIntegerOrUndefined(value: unknown) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function iapOrderStatusMaxAttempts(options: TossMtlsCoreOptions = {}) {
  return parsePositiveInteger(options.iapOrderStatusMaxAttempts, DEFAULT_IAP_ORDER_STATUS_MAX_ATTEMPTS);
}

function iapOrderStatusRetryDelayMs(options: TossMtlsCoreOptions = {}) {
  return parseNonNegativeInteger(options.iapOrderStatusRetryDelayMs, DEFAULT_IAP_ORDER_STATUS_RETRY_DELAY_MS);
}

function isRetryableIapOrderStatus(result: unknown) {
  const object = objectOrSelf(result, {});
  if (!object.ok) return false;
  return RETRYABLE_IAP_ORDER_STATUSES.has(String(object.providerStatus || "").trim().toUpperCase());
}

function defaultSleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function debugLog(options: TossMtlsCoreOptions, message: string, fields: Record<string, unknown> = {}) {
  if (!options.debug) return;
  if (options.log) {
    options.log(message, fields);
  }
}

export function numberOrUndefined(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function stringOrUndefined(value: unknown) {
  const trimmed = String(value ?? "").trim();
  return trimmed ? trimmed : undefined;
}

async function sha256Hex(value: string) {
  const bytes = new TextEncoder().encode(value);
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    const digest = await subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  return sha256FallbackHex(bytes);
}

function sha256FallbackHex(bytes: Uint8Array) {
  const words = new Array(64).fill(0);
  const hash = [
    0x6a09e667,
    0xbb67ae85,
    0x3c6ef372,
    0xa54ff53a,
    0x510e527f,
    0x9b05688c,
    0x1f83d9ab,
    0x5be0cd19,
  ];
  const constants = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  const bitLength = bytes.length * 8;
  const paddedLength = (((bytes.length + 9 + 63) >> 6) << 6);
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLength - 4, bitLength, false);
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      words[index] = view.getUint32(offset + index * 4, false);
    }
    for (let index = 16; index < 64; index += 1) {
      const s0 = rotateRight(words[index - 15], 7) ^ rotateRight(words[index - 15], 18) ^ (words[index - 15] >>> 3);
      const s1 = rotateRight(words[index - 2], 17) ^ rotateRight(words[index - 2], 19) ^ (words[index - 2] >>> 10);
      words[index] = (words[index - 16] + s0 + words[index - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = hash;
    for (let index = 0; index < 64; index += 1) {
      const s1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + ch + constants[index] + words[index]) >>> 0;
      const s0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    hash[0] = (hash[0] + a) >>> 0;
    hash[1] = (hash[1] + b) >>> 0;
    hash[2] = (hash[2] + c) >>> 0;
    hash[3] = (hash[3] + d) >>> 0;
    hash[4] = (hash[4] + e) >>> 0;
    hash[5] = (hash[5] + f) >>> 0;
    hash[6] = (hash[6] + g) >>> 0;
    hash[7] = (hash[7] + h) >>> 0;
  }
  return hash.map((word) => word.toString(16).padStart(8, "0")).join("");
}

function rotateRight(value: number, bits: number) {
  return (value >>> bits) | (value << (32 - bits));
}

export class TossMtlsCoreError extends Error {
  status: number;
  code: string;
  publicMessage: string;
  override cause?: unknown;

  constructor(status: number, code: string, publicMessage: string, cause: unknown = undefined) {
    super(publicMessage);
    this.name = "TossMtlsCoreError";
    this.status = status;
    this.code = code;
    this.publicMessage = publicMessage;
    this.cause = cause;
  }
}

export function clientError(code: string, publicMessage: string, status = 400, cause: unknown = undefined) {
  return new TossMtlsCoreError(status, code, publicMessage, cause);
}

export function configError(code: string, publicMessage: string, cause: unknown = undefined) {
  return new TossMtlsCoreError(500, code, publicMessage, cause);
}

export function upstreamError(code: string, publicMessage: string, status = 502, cause: unknown = undefined) {
  return new TossMtlsCoreError(status, code, publicMessage, cause);
}

export function publicError(error: unknown) {
  if (error instanceof TossMtlsCoreError) {
    return {
      status: error.status,
      code: error.code,
      message: error.publicMessage,
    };
  }
  return {
    status: 500,
    code: "PROXY_ERROR",
    message: "Proxy request failed",
  };
}
