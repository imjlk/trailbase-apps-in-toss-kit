import {
  postAppsInTossJson,
  type AppsInTossHeaders,
  type AppsInTossJsonFetcher,
} from "./internal/http";

export type AppsInTossPromotionClaimStatus =
  | "ALREADY_GRANTED"
  | "EXHAUSTED"
  | "FAILED"
  | "GRANTED"
  | "NOT_ELIGIBLE"
  | "PENDING";

export interface AppsInTossPromotionClaimResult {
  alreadyGranted: boolean;
  campaignId: string;
  granted: boolean;
  rewardAmount?: number;
  status: AppsInTossPromotionClaimStatus;
}

export interface AppsInTossPromotionClaimInput {
  campaignId: string;
  context?: Record<string, unknown>;
  eligibilityId?: string | null;
  requestId?: string | null;
}

export interface AppsInTossPromotionStatusInput {
  campaignId: string;
  requestId: string;
}

export interface AppsInTossPromotionStatusResult extends AppsInTossPromotionClaimResult {
  requestId: string;
}

export interface CreateAppsInTossPromotionCampaignClientOptions<
  TResult = AppsInTossPromotionClaimResult,
> {
  baseUrl?: string;
  claimEndpoint: string;
  fetcher?: AppsInTossJsonFetcher;
  getAuthHeaders?: () => AppsInTossHeaders | Promise<AppsInTossHeaders>;
  normalizeResponse?: (value: unknown) => TResult;
}

export interface CreateAppsInTossPromotionStatusClientOptions<
  TResult = AppsInTossPromotionStatusResult,
> {
  baseUrl?: string;
  statusEndpoint: string;
  fetcher?: AppsInTossJsonFetcher;
  getAuthHeaders?: () => AppsInTossHeaders | Promise<AppsInTossHeaders>;
  normalizeResponse?: (value: unknown) => TResult;
}

export interface AppsInTossPromotionCampaignClient<
  TResult = AppsInTossPromotionClaimResult,
> {
  claim(input: AppsInTossPromotionClaimInput): Promise<TResult>;
}

export interface AppsInTossPromotionStatusClient<
  TResult = AppsInTossPromotionStatusResult,
> {
  getStatus(input: AppsInTossPromotionStatusInput): Promise<TResult>;
}

export type AppsInTossPromotionCampaignClientErrorCode =
  | "PROMOTION_CAMPAIGN_ID_REQUIRED"
  | "PROMOTION_CLAIM_INVALID_RESPONSE"
  | "PROMOTION_REQUEST_ID_REQUIRED"
  | "PROMOTION_STATUS_INVALID_RESPONSE";

export class AppsInTossPromotionCampaignClientError extends Error {
  code: AppsInTossPromotionCampaignClientErrorCode;
  override cause?: unknown;

  constructor({
    cause,
    code,
    message,
  }: {
    cause?: unknown;
    code: AppsInTossPromotionCampaignClientErrorCode;
    message: string;
  }) {
    super(message);
    this.name = "AppsInTossPromotionCampaignClientError";
    this.code = code;
    this.cause = cause;
  }
}

export function createAppsInTossPromotionCampaignClient<
  TResult = AppsInTossPromotionClaimResult,
>({
  baseUrl,
  claimEndpoint,
  fetcher,
  getAuthHeaders,
  normalizeResponse,
}: CreateAppsInTossPromotionCampaignClientOptions<TResult>): AppsInTossPromotionCampaignClient<TResult> {
  return {
    async claim(input: AppsInTossPromotionClaimInput) {
      const { campaignId, context, eligibilityId, requestId } = input;
      const normalizedCampaignId = normalizeRequiredCampaignId(campaignId);
      const sanitizedContext = sanitizePromotionClaimContext(context);
      const normalizedEligibilityId = normalizeOptionalString(eligibilityId);
      const normalizedRequestId = normalizeOptionalString(requestId);
      const payload = await postAppsInTossJson({
        baseUrl,
        body: {
          campaignId: normalizedCampaignId,
          ...(sanitizedContext === undefined
            ? {}
            : { context: sanitizedContext }),
          ...(normalizedEligibilityId
            ? { eligibilityId: normalizedEligibilityId }
            : {}),
          ...(normalizedRequestId ? { requestId: normalizedRequestId } : {}),
        },
        fetcher,
        getAuthHeaders,
        path: claimEndpoint,
      });
      return normalizeResponse
        ? normalizeResponse(payload)
        : (normalizeAppsInTossPromotionClaimResult(payload, {
            campaignId: normalizedCampaignId,
          }) as TResult);
    },
  };
}

export function createAppsInTossPromotionStatusClient<
  TResult = AppsInTossPromotionStatusResult,
>({
  baseUrl,
  fetcher,
  getAuthHeaders,
  normalizeResponse,
  statusEndpoint,
}: CreateAppsInTossPromotionStatusClientOptions<TResult>): AppsInTossPromotionStatusClient<TResult> {
  return {
    async getStatus(input: AppsInTossPromotionStatusInput) {
      const normalizedCampaignId = normalizeRequiredCampaignId(
        input.campaignId,
      );
      const normalizedRequestId = normalizeRequiredRequestId(input.requestId);
      const payload = await postAppsInTossJson({
        baseUrl,
        body: {
          campaignId: normalizedCampaignId,
          requestId: normalizedRequestId,
        },
        fetcher,
        getAuthHeaders,
        path: statusEndpoint,
      });
      return normalizeResponse
        ? normalizeResponse(payload)
        : (normalizeAppsInTossPromotionStatusResult(payload, {
            campaignId: normalizedCampaignId,
            requestId: normalizedRequestId,
          }) as TResult);
    },
  };
}

export function normalizeAppsInTossPromotionClaimResult(
  value: unknown,
  options: { campaignId?: string } = {},
): AppsInTossPromotionClaimResult {
  const { record, nestedGrant, nestedPromotion, nestedReward } =
    promotionResponseCandidates(value);
  const records = [record, nestedGrant, nestedPromotion, nestedReward].filter(
    (candidate): candidate is Record<string, unknown> => candidate !== null,
  );
  const responseCampaignIds = uniqueStringCandidates(
    collectRecordValues(records, ["campaignId", "campaign_id"]),
  );
  const expectedCampaignId = normalizeOptionalString(options.campaignId);
  if (
    responseCampaignIds.length > 1 ||
    (expectedCampaignId !== undefined &&
      responseCampaignIds.length > 0 &&
      responseCampaignIds[0] !== expectedCampaignId)
  ) {
    throwInvalidPromotionClaimResponse(value);
  }
  const campaignId = responseCampaignIds[0] ?? expectedCampaignId;
  if (!campaignId) {
    throwInvalidPromotionClaimResponse(value);
  }

  const alreadyGranted = resolveBooleanClaimFlag(
    collectRecordValues(records, ["alreadyGranted", "already_granted"]),
    value,
  );
  const granted = resolveBooleanClaimFlag(
    collectRecordValues(records, ["granted", "isGranted", "is_granted"]),
    value,
  );
  const status = resolvePromotionClaimStatus(
    collectRecordValues(records, [
      "status",
      "rewardStatus",
      "reward_status",
      "providerStatus",
      "provider_status",
    ]),
    { alreadyGranted, granted },
    value,
  );

  const rewardAmount = numberCandidate(
    record?.rewardAmount,
    record?.reward_amount,
    record?.amount,
    nestedGrant?.rewardAmount,
    nestedGrant?.reward_amount,
    nestedGrant?.amount,
    nestedPromotion?.rewardAmount,
    nestedPromotion?.reward_amount,
    nestedReward?.rewardAmount,
    nestedReward?.reward_amount,
  );

  return {
    alreadyGranted: status === "ALREADY_GRANTED",
    campaignId,
    granted: status === "GRANTED" || status === "ALREADY_GRANTED",
    ...(rewardAmount === undefined ? {} : { rewardAmount }),
    status,
  };
}

export function normalizeAppsInTossPromotionStatusResult(
  value: unknown,
  options: { campaignId: string; requestId: string },
): AppsInTossPromotionStatusResult {
  const campaignId = normalizeRequiredCampaignId(options.campaignId);
  const requestId = normalizeRequiredRequestId(options.requestId);
  const responseRequestIds = uniqueStringCandidates(
    collectRecordValues(promotionResponseRecords(value), [
      "requestId",
      "request_id",
    ]),
  );
  if (responseRequestIds.length !== 1 || responseRequestIds[0] !== requestId) {
    throwInvalidPromotionStatusResponse(value);
  }

  try {
    return {
      ...normalizeAppsInTossPromotionClaimResult(value, { campaignId }),
      requestId,
    };
  } catch (error) {
    if (
      error instanceof AppsInTossPromotionCampaignClientError &&
      error.code === "PROMOTION_CLAIM_INVALID_RESPONSE"
    ) {
      throwInvalidPromotionStatusResponse(value);
    }
    throw error;
  }
}

export function sanitizePromotionClaimContext(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sanitizePromotionClaimContext);
  }
  if (!value || typeof value !== "object") {
    return value;
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, entryValue] of Object.entries(value)) {
    if (isForbiddenPromotionClientKey(key)) {
      continue;
    }
    sanitized[key] = sanitizePromotionClaimContext(entryValue);
  }
  return sanitized;
}

function resolvePromotionClaimStatus(
  values: unknown[],
  flags: { alreadyGranted?: boolean; granted?: boolean },
  cause: unknown,
): AppsInTossPromotionClaimStatus {
  const normalized = values.map(normalizePromotionClaimStatusValue);

  if (normalized.includes("UNKNOWN")) {
    throwInvalidPromotionClaimResponse(cause);
  }

  const recognizedStatuses = uniqueStatuses(
    normalized.filter(
      (status): status is AppsInTossPromotionClaimStatus => status !== null,
    ),
  );
  const successStatuses = recognizedStatuses.filter(
    (status) => status === "GRANTED" || status === "ALREADY_GRANTED",
  );
  const nonSuccessStatuses = recognizedStatuses.filter(
    (status) => status !== "GRANTED" && status !== "ALREADY_GRANTED",
  );

  if (
    (successStatuses.length > 0 && nonSuccessStatuses.length > 0) ||
    nonSuccessStatuses.length > 1
  ) {
    throwInvalidPromotionClaimResponse(cause);
  }

  if (successStatuses.length > 0) {
    const alreadyGrantedOutcome =
      flags.alreadyGranted === true ||
      successStatuses.includes("ALREADY_GRANTED");
    if (
      (flags.granted === false && !alreadyGrantedOutcome) ||
      (flags.alreadyGranted === false &&
        successStatuses.includes("ALREADY_GRANTED"))
    ) {
      throwInvalidPromotionClaimResponse(cause);
    }
    return alreadyGrantedOutcome ? "ALREADY_GRANTED" : "GRANTED";
  }

  if (nonSuccessStatuses.length > 0) {
    if (flags.granted === true || flags.alreadyGranted === true) {
      throwInvalidPromotionClaimResponse(cause);
    }
    return nonSuccessStatuses[0];
  }

  if (flags.alreadyGranted === true) {
    return "ALREADY_GRANTED";
  }
  if (flags.granted === true) {
    return "GRANTED";
  }

  throwInvalidPromotionClaimResponse(cause);
}

type PromotionClaimStatusCandidate = AppsInTossPromotionClaimStatus | "UNKNOWN";

function normalizePromotionClaimStatusValue(
  value: unknown,
): PromotionClaimStatusCandidate | null {
  const normalized = stringCandidate(value)
    ?.replace(/([a-z])([A-Z])/g, "$1_$2")
    .replace(/[\s-]+/g, "_")
    .toUpperCase();
  if (!normalized) {
    return null;
  }
  if (
    normalized === "GRANTED" ||
    normalized === "SUCCESS" ||
    normalized === "SUCCEEDED"
  ) {
    return "GRANTED";
  }
  if (normalized === "ALREADY_GRANTED" || normalized === "DUPLICATE") {
    return "ALREADY_GRANTED";
  }
  if (
    normalized === "PENDING" ||
    normalized === "REQUESTED" ||
    normalized === "PROCESSING"
  ) {
    return "PENDING";
  }
  if (normalized === "NOT_ELIGIBLE" || normalized === "INELIGIBLE") {
    return "NOT_ELIGIBLE";
  }
  if (normalized === "EXHAUSTED" || normalized === "BUDGET_EXHAUSTED") {
    return "EXHAUSTED";
  }
  if (
    normalized === "FAILED" ||
    normalized === "FAIL" ||
    normalized === "ERROR"
  ) {
    return "FAILED";
  }
  return "UNKNOWN";
}

function throwInvalidPromotionClaimResponse(cause: unknown): never {
  throw new AppsInTossPromotionCampaignClientError({
    cause,
    code: "PROMOTION_CLAIM_INVALID_RESPONSE",
    message: "Apps in Toss promotion claim response was invalid.",
  });
}

function throwInvalidPromotionStatusResponse(cause: unknown): never {
  throw new AppsInTossPromotionCampaignClientError({
    cause,
    code: "PROMOTION_STATUS_INVALID_RESPONSE",
    message: "Apps in Toss promotion status response was invalid.",
  });
}

function normalizeRequiredCampaignId(value: string) {
  const normalized = normalizeOptionalString(value);
  if (!normalized) {
    throw new AppsInTossPromotionCampaignClientError({
      code: "PROMOTION_CAMPAIGN_ID_REQUIRED",
      message: "Apps in Toss promotion campaignId is required.",
    });
  }
  return normalized;
}

function normalizeRequiredRequestId(value: string) {
  const normalized = normalizeOptionalString(value);
  if (!normalized) {
    throw new AppsInTossPromotionCampaignClientError({
      code: "PROMOTION_REQUEST_ID_REQUIRED",
      message: "Apps in Toss promotion requestId is required.",
    });
  }
  return normalized;
}

function isForbiddenPromotionClientKey(key: string) {
  const normalized = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
  return [
    "mtlsproxytoken",
    "promotioncode",
    "providerpromotioncode",
    "rawtossuserkey",
    "tosspromotioncode",
    "tossuserkey",
    "tossuserkeyhmac",
    "tossuserkeysealed",
    "userkey",
  ].includes(normalized);
}

function objectCandidate(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function promotionResponseRecords(value: unknown) {
  const { record, nestedGrant, nestedPromotion, nestedReward } =
    promotionResponseCandidates(value);
  return [record, nestedGrant, nestedPromotion, nestedReward].filter(
    (candidate): candidate is Record<string, unknown> => candidate !== null,
  );
}

function promotionResponseCandidates(value: unknown) {
  const record = objectCandidate(value);
  return {
    record,
    nestedGrant: objectCandidate(record?.grant),
    nestedPromotion: objectCandidate(record?.promotion),
    nestedReward: objectCandidate(record?.reward),
  };
}

function stringCandidate(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }
  return undefined;
}

function normalizeOptionalString(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function collectRecordValues(
  records: Record<string, unknown>[],
  keys: string[],
) {
  return records.flatMap((record) => keys.map((key) => record[key]));
}

function resolveBooleanClaimFlag(values: unknown[], cause: unknown) {
  const candidates = [
    ...new Set(
      values.filter((value): value is boolean => typeof value === "boolean"),
    ),
  ];
  if (candidates.length > 1) {
    throwInvalidPromotionClaimResponse(cause);
  }
  return candidates[0];
}

function uniqueStatuses(values: AppsInTossPromotionClaimStatus[]) {
  return [...new Set(values)];
}

function uniqueStringCandidates(values: unknown[]) {
  return [
    ...new Set(
      values
        .map((value) => stringCandidate(value))
        .filter((value): value is string => value !== undefined),
    ),
  ];
}

function numberCandidate(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }
  return undefined;
}
