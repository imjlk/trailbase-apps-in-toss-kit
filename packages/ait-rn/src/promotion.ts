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
  failureReason?: string;
  granted: boolean;
  providerErrorCode?: string;
  providerRequestId?: string;
  rewardAmount?: number;
  status: AppsInTossPromotionClaimStatus;
}

export interface AppsInTossPromotionClaimInput {
  campaignId: string;
  context?: Record<string, unknown>;
  eligibilityId?: string | null;
  requestId?: string | null;
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

export interface AppsInTossPromotionCampaignClient<
  TResult = AppsInTossPromotionClaimResult,
> {
  claim(input: AppsInTossPromotionClaimInput): Promise<TResult>;
}

export type AppsInTossPromotionCampaignClientErrorCode =
  | "PROMOTION_CAMPAIGN_ID_REQUIRED"
  | "PROMOTION_CLAIM_INVALID_RESPONSE";

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
}: CreateAppsInTossPromotionCampaignClientOptions<TResult>): AppsInTossPromotionCampaignClient<
  TResult
> {
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
          ...(normalizedRequestId
            ? { requestId: normalizedRequestId }
            : {}),
        },
        fetcher,
        getAuthHeaders,
        path: claimEndpoint,
      });
      return normalizeResponse
        ? normalizeResponse(payload)
        : (normalizeAppsInTossPromotionClaimResult(payload) as TResult);
    },
  };
}

export function normalizeAppsInTossPromotionClaimResult(
  value: unknown,
): AppsInTossPromotionClaimResult {
  const record = objectCandidate(value);
  const nestedGrant = objectCandidate(record?.grant);
  const nestedPromotion = objectCandidate(record?.promotion);
  const nestedReward = objectCandidate(record?.reward);
  const campaignId = stringCandidate(
    record?.campaignId,
    record?.campaign_id,
    nestedGrant?.campaignId,
    nestedGrant?.campaign_id,
    nestedPromotion?.campaignId,
    nestedPromotion?.campaign_id,
    nestedReward?.campaignId,
    nestedReward?.campaign_id,
  );
  const alreadyGranted = booleanCandidate(
    record?.alreadyGranted,
    record?.already_granted,
    nestedGrant?.alreadyGranted,
    nestedGrant?.already_granted,
    nestedPromotion?.alreadyGranted,
    nestedPromotion?.already_granted,
    nestedReward?.alreadyGranted,
    nestedReward?.already_granted,
  );
  const granted = booleanCandidate(
    record?.granted,
    record?.isGranted,
    record?.is_granted,
    nestedGrant?.granted,
    nestedGrant?.isGranted,
    nestedGrant?.is_granted,
    nestedPromotion?.granted,
    nestedPromotion?.isGranted,
    nestedPromotion?.is_granted,
    nestedReward?.granted,
    nestedReward?.isGranted,
    nestedReward?.is_granted,
  );
  const status = normalizePromotionClaimStatus(
    record?.status,
    record?.rewardStatus,
    record?.reward_status,
    record?.providerStatus,
    record?.provider_status,
    nestedGrant?.status,
    nestedGrant?.providerStatus,
    nestedGrant?.provider_status,
    nestedPromotion?.status,
    nestedPromotion?.providerStatus,
    nestedPromotion?.provider_status,
    nestedReward?.status,
    nestedReward?.providerStatus,
    nestedReward?.provider_status,
    alreadyGranted ? "ALREADY_GRANTED" : undefined,
    granted ? "GRANTED" : undefined,
  );

  if (!campaignId || !status) {
    throw new AppsInTossPromotionCampaignClientError({
      cause: value,
      code: "PROMOTION_CLAIM_INVALID_RESPONSE",
      message: "Apps in Toss promotion claim response was invalid.",
    });
  }

  return {
    alreadyGranted: status === "ALREADY_GRANTED" || alreadyGranted === true,
    campaignId,
    failureReason: stringCandidate(
      record?.failureReason,
      record?.failure_reason,
      nestedGrant?.failureReason,
      nestedGrant?.failure_reason,
      nestedPromotion?.failureReason,
      nestedPromotion?.failure_reason,
      nestedReward?.failureReason,
      nestedReward?.failure_reason,
    ),
    granted:
      status === "GRANTED" ||
      status === "ALREADY_GRANTED" ||
      granted === true,
    providerErrorCode: stringCandidate(
      record?.providerErrorCode,
      record?.provider_error_code,
      nestedGrant?.providerErrorCode,
      nestedGrant?.provider_error_code,
      nestedPromotion?.providerErrorCode,
      nestedPromotion?.provider_error_code,
      nestedReward?.providerErrorCode,
      nestedReward?.provider_error_code,
    ),
    providerRequestId: stringCandidate(
      record?.providerRequestId,
      record?.provider_request_id,
      nestedGrant?.providerRequestId,
      nestedGrant?.provider_request_id,
      nestedPromotion?.providerRequestId,
      nestedPromotion?.provider_request_id,
      nestedReward?.providerRequestId,
      nestedReward?.provider_request_id,
    ),
    rewardAmount: numberCandidate(
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
    ),
    status,
  };
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

function normalizePromotionClaimStatus(
  ...values: unknown[]
): AppsInTossPromotionClaimStatus | null {
  for (const value of values) {
    const normalized = stringCandidate(value)
      ?.replace(/([a-z])([A-Z])/g, "$1_$2")
      .replace(/[\s-]+/g, "_")
      .toUpperCase();
    if (!normalized) {
      continue;
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
  }
  return null;
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

function isForbiddenPromotionClientKey(key: string) {
  const normalized = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
  return [
    "mtlsproxytoken",
    "promotioncode",
    "providerpromotioncode",
    "rawtossuserkey",
    "tosspromotioncode",
    "tossuserkey",
    "userkey",
  ].includes(normalized);
}

function objectCandidate(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
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

function booleanCandidate(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "boolean") {
      return value;
    }
  }
  return undefined;
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
