import {
  postAppsInTossJson,
  type AppsInTossHeaders,
  type AppsInTossJsonFetcher,
} from "./internal/http";

export const APPS_IN_TOSS_NOTIFICATION_AGREEMENT_SDK_SOURCE =
  "apps_in_toss_sdk";

export type AppsInTossNotificationAgreementResult =
  | "newAgreement"
  | "alreadyAgreed"
  | "agreementRejected";

export type AppsInTossNotificationAgreementStatus = "OPTED_IN" | "OPTED_OUT";

export interface AppsInTossNotificationAgreementPayload {
  result: AppsInTossNotificationAgreementResult;
  source: typeof APPS_IN_TOSS_NOTIFICATION_AGREEMENT_SDK_SOURCE;
  status: AppsInTossNotificationAgreementStatus;
  template_code: string;
  templateCode: string;
}

export type AppsInTossNotificationAgreementErrorCode =
  | "FUNCTIONAL_MESSAGE_REQUEST_ENDPOINT_MISSING"
  | "REQUEST_NOTIFICATION_AGREEMENT_FAILED"
  | "REQUEST_NOTIFICATION_AGREEMENT_INVALID_RESULT"
  | "REQUEST_NOTIFICATION_AGREEMENT_TEMPLATE_CODE_REQUIRED"
  | "REQUEST_NOTIFICATION_AGREEMENT_THROWN"
  | "REQUEST_NOTIFICATION_AGREEMENT_UNAVAILABLE";

export interface AppsInTossNotificationAgreementErrorOptions {
  cause?: unknown;
  code: AppsInTossNotificationAgreementErrorCode;
  message: string;
}

export class AppsInTossNotificationAgreementError extends Error {
  code: AppsInTossNotificationAgreementErrorCode;
  override cause?: unknown;

  constructor({
    cause,
    code,
    message,
  }: AppsInTossNotificationAgreementErrorOptions) {
    super(message);
    this.name = "AppsInTossNotificationAgreementError";
    this.code = code;
    this.cause = cause;
  }
}

export function normalizeAppsInTossNotificationAgreementResult(
  value: unknown,
): AppsInTossNotificationAgreementResult | null {
  if (
    value === "newAgreement" ||
    value === "alreadyAgreed" ||
    value === "agreementRejected"
  ) {
    return value;
  }
  if (value && typeof value === "object") {
    return normalizeAppsInTossNotificationAgreementResult(
      (value as Record<string, unknown>).type,
    );
  }
  return null;
}

export function appsInTossNotificationAgreementStatus(
  result: AppsInTossNotificationAgreementResult,
): AppsInTossNotificationAgreementStatus {
  return result === "agreementRejected" ? "OPTED_OUT" : "OPTED_IN";
}

export type AppsInTossFunctionalMessageOperation =
  | "requestMessage"
  | "syncAgreement";

export interface AppsInTossFunctionalMessageEndpoints {
  /**
   * App route that queues a functional message on the caller's behalf. Omit it
   * when the server queues messages itself; `requestMessage` then rejects
   * without a network call.
   */
  requestMessage?: string;
  syncAgreement: string;
}

export interface CreateAppsInTossFunctionalMessageClientOptions<
  TAgreementSyncResult = unknown,
  TMessageRequestResult = unknown,
> {
  baseUrl?: string;
  endpoints: AppsInTossFunctionalMessageEndpoints;
  fetcher?: AppsInTossJsonFetcher;
  getAuthHeaders?: () => AppsInTossHeaders | Promise<AppsInTossHeaders>;
  normalizeResponse?: (
    value: unknown,
    context: { operation: AppsInTossFunctionalMessageOperation },
  ) => TAgreementSyncResult | TMessageRequestResult;
}

export interface AppsInTossNotificationAgreementSyncInput {
  result: AppsInTossNotificationAgreementResult;
  source?: typeof APPS_IN_TOSS_NOTIFICATION_AGREEMENT_SDK_SOURCE | string;
  status?: AppsInTossNotificationAgreementStatus;
  templateCode: string;
}

export interface AppsInTossFunctionalMessageRequestInput {
  agreementTemplateCode?: string | null;
  context?: Record<string, unknown>;
  providerRequestId?: string | null;
  templateSetCode: string;
}

export interface AppsInTossFunctionalMessageClient<
  TAgreementSyncResult = unknown,
  TMessageRequestResult = unknown,
> {
  requestMessage(
    input: AppsInTossFunctionalMessageRequestInput,
  ): Promise<TMessageRequestResult>;
  syncAgreement(
    input: AppsInTossNotificationAgreementSyncInput,
  ): Promise<TAgreementSyncResult>;
}

export function createAppsInTossFunctionalMessageClient<
  TAgreementSyncResult = unknown,
  TMessageRequestResult = unknown,
>({
  baseUrl,
  endpoints,
  fetcher,
  getAuthHeaders,
  normalizeResponse,
}: CreateAppsInTossFunctionalMessageClientOptions<
  TAgreementSyncResult,
  TMessageRequestResult
>): AppsInTossFunctionalMessageClient<
  TAgreementSyncResult,
  TMessageRequestResult
> {
  return {
    async requestMessage({
      agreementTemplateCode,
      context,
      providerRequestId,
      templateSetCode,
    }) {
      const path = endpoints.requestMessage;
      if (!path) {
        throw new AppsInTossNotificationAgreementError({
          code: "FUNCTIONAL_MESSAGE_REQUEST_ENDPOINT_MISSING",
          message:
            "Apps in Toss functional message requestMessage endpoint is not configured.",
        });
      }
      const normalizedAgreementTemplateCode =
        normalizeOptionalCode(agreementTemplateCode);
      const normalizedProviderRequestId =
        normalizeOptionalCode(providerRequestId);
      const payload = await postAppsInTossJson({
        baseUrl,
        body: {
          ...(normalizedAgreementTemplateCode
            ? { agreementTemplateCode: normalizedAgreementTemplateCode }
            : {}),
          ...(context === undefined ? {} : { context }),
          ...(normalizedProviderRequestId
            ? { providerRequestId: normalizedProviderRequestId }
            : {}),
          templateSetCode: normalizeRequiredCode(
            templateSetCode,
            "REQUEST_NOTIFICATION_AGREEMENT_TEMPLATE_CODE_REQUIRED",
            "Apps in Toss functional message templateSetCode is required.",
          ),
        },
        fetcher,
        getAuthHeaders,
        path,
      });
      return normalizeFunctionalMessageResponse<TMessageRequestResult>(
        payload,
        "requestMessage",
        normalizeResponse,
      );
    },
    async syncAgreement({ result, source, status, templateCode }) {
      const normalizedResult =
        normalizeAppsInTossNotificationAgreementResult(result);
      if (!normalizedResult) {
        throw new AppsInTossNotificationAgreementError({
          cause: result,
          code: "REQUEST_NOTIFICATION_AGREEMENT_INVALID_RESULT",
          message: "Apps in Toss notification agreement result was invalid.",
        });
      }
      const normalizedTemplateCode = normalizeRequiredCode(
        templateCode,
        "REQUEST_NOTIFICATION_AGREEMENT_TEMPLATE_CODE_REQUIRED",
        "Apps in Toss notification agreement templateCode is required.",
      );
      const payload = await postAppsInTossJson({
        baseUrl,
        body: {
          result: normalizedResult,
          source: source ?? APPS_IN_TOSS_NOTIFICATION_AGREEMENT_SDK_SOURCE,
          status:
            status ?? appsInTossNotificationAgreementStatus(normalizedResult),
          template_code: normalizedTemplateCode,
        },
        fetcher,
        getAuthHeaders,
        path: endpoints.syncAgreement,
      });
      return normalizeFunctionalMessageResponse<TAgreementSyncResult>(
        payload,
        "syncAgreement",
        normalizeResponse,
      );
    },
  };
}

function normalizeFunctionalMessageResponse<TResult>(
  payload: unknown,
  operation: AppsInTossFunctionalMessageOperation,
  normalizeResponse?: CreateAppsInTossFunctionalMessageClientOptions<
    unknown,
    unknown
  >["normalizeResponse"],
) {
  return normalizeResponse
    ? (normalizeResponse(payload, { operation }) as TResult)
    : (payload as TResult);
}

function normalizeRequiredCode(
  value: string,
  code: AppsInTossNotificationAgreementErrorCode,
  message: string,
) {
  const normalized = normalizeOptionalCode(value);
  if (!normalized) {
    throw new AppsInTossNotificationAgreementError({ code, message });
  }
  return normalized;
}

function normalizeOptionalCode(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
