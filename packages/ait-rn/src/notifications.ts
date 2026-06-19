import { normalizeAppsInTossErrorMessage } from "@trailbase-apps-in-toss-kit/trailbase-client";
import {
  defaultFrameworkFunction,
  type AppsInTossRequestNotificationAgreement,
} from "./internal/framework";
import {
  postAppsInTossJson,
  type AppsInTossHeaders,
  type AppsInTossJsonFetcher,
} from "./internal/http";
import { isProductionEnv, resolveRuntimeEnv } from "./internal/runtime";

export type { AppsInTossRequestNotificationAgreement } from "./internal/framework";

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

export interface AppsInTossNotificationAgreementRequestOptions {
  templateCode: string;
}

export interface AppsInTossNotificationAgreementDevFallbackContext {
  error?: unknown;
  templateCode: string;
}

export type AppsInTossNotificationAgreementDevFallback = (
  context: AppsInTossNotificationAgreementDevFallbackContext,
) =>
  | AppsInTossNotificationAgreementPayload
  | AppsInTossNotificationAgreementResult
  | Promise<
      | AppsInTossNotificationAgreementPayload
      | AppsInTossNotificationAgreementResult
    >;

export type AppsInTossNotificationAgreementErrorCode =
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

export interface CreateAppsInTossNotificationAgreementBridgeOptions {
  createDevFallback?: AppsInTossNotificationAgreementDevFallback;
  env?: string;
  production?: boolean;
  requestNotificationAgreement?: AppsInTossRequestNotificationAgreement;
}

export interface AppsInTossNotificationAgreementBridge {
  requestAgreement(
    options: AppsInTossNotificationAgreementRequestOptions,
  ): Promise<AppsInTossNotificationAgreementPayload>;
}

export function createAppsInTossNotificationAgreementBridge({
  createDevFallback,
  env,
  production,
  requestNotificationAgreement,
}: CreateAppsInTossNotificationAgreementBridgeOptions = {}): AppsInTossNotificationAgreementBridge {
  const resolvedProduction =
    production ?? isProductionEnv(resolveRuntimeEnv({ env, production }));

  return {
    async requestAgreement({ templateCode }) {
      const normalizedTemplateCode = normalizeRequiredCode(
        templateCode,
        "REQUEST_NOTIFICATION_AGREEMENT_TEMPLATE_CODE_REQUIRED",
        "Apps in Toss notification agreement templateCode is required.",
      );
      const resolvedRequestNotificationAgreement =
        requestNotificationAgreement ??
        (await defaultFrameworkFunction("requestNotificationAgreement"));

      if (!resolvedRequestNotificationAgreement) {
        return handleNotificationAgreementFallback({
          createDevFallback,
          error: new AppsInTossNotificationAgreementError({
            code: "REQUEST_NOTIFICATION_AGREEMENT_UNAVAILABLE",
            message:
              "Apps in Toss requestNotificationAgreement is not available in this runtime.",
          }),
          production: resolvedProduction,
          templateCode: normalizedTemplateCode,
        });
      }

      try {
        return await requestAppsInTossNotificationAgreement({
          requestNotificationAgreement: resolvedRequestNotificationAgreement,
          templateCode: normalizedTemplateCode,
        });
      } catch (error) {
        return handleNotificationAgreementFallback({
          createDevFallback,
          error,
          production: resolvedProduction,
          templateCode: normalizedTemplateCode,
        });
      }
    },
  };
}

export interface RequestAppsInTossNotificationAgreementOptions {
  requestNotificationAgreement: AppsInTossRequestNotificationAgreement;
  templateCode: string;
}

export function requestAppsInTossNotificationAgreement({
  requestNotificationAgreement,
  templateCode,
}: RequestAppsInTossNotificationAgreementOptions): Promise<AppsInTossNotificationAgreementPayload> {
  const normalizedTemplateCode = normalizeRequiredCode(
    templateCode,
    "REQUEST_NOTIFICATION_AGREEMENT_TEMPLATE_CODE_REQUIRED",
    "Apps in Toss notification agreement templateCode is required.",
  );

  return new Promise((resolve, reject) => {
    let cleanup: (() => void) | undefined;
    let cleanupPending = false;
    let completed = false;

    const runCleanup = () => {
      if (!cleanup) {
        cleanupPending = true;
        return;
      }
      cleanupPending = false;
      const cleanupFn = cleanup;
      cleanup = undefined;
      try {
        cleanupFn();
      } catch {
        // SDK listener cleanup is best-effort and should not hide the result.
      }
    };

    const complete = (
      callback: (settle: {
        resolve: typeof resolve;
        reject: typeof reject;
      }) => void,
    ) => {
      if (completed) {
        return;
      }
      completed = true;
      runCleanup();
      callback({ reject, resolve });
    };

    try {
      const returnedCleanup = requestNotificationAgreement({
        options: { templateCode: normalizedTemplateCode },
        onEvent: (event) => {
          const result = normalizeAppsInTossNotificationAgreementResult(event);
          complete(({ reject, resolve }) => {
            if (!result) {
              reject(
                new AppsInTossNotificationAgreementError({
                  cause: event,
                  code: "REQUEST_NOTIFICATION_AGREEMENT_INVALID_RESULT",
                  message: "Apps in Toss notification agreement result was invalid.",
                }),
              );
              return;
            }
            resolve(notificationAgreementPayload(normalizedTemplateCode, result));
          });
        },
        onError: (error) => {
          complete(({ reject }) => {
            reject(
              new AppsInTossNotificationAgreementError({
                cause: error,
                code: "REQUEST_NOTIFICATION_AGREEMENT_FAILED",
                message: normalizeAppsInTossErrorMessage(
                  error,
                  "Apps in Toss notification agreement request failed.",
                ),
              }),
            );
          });
        },
      });

      if (typeof returnedCleanup === "function") {
        cleanup = returnedCleanup;
      }
      if (cleanupPending) {
        runCleanup();
      }
    } catch (error) {
      complete(({ reject }) => {
        reject(
          new AppsInTossNotificationAgreementError({
            cause: error,
            code: "REQUEST_NOTIFICATION_AGREEMENT_THROWN",
            message: normalizeAppsInTossErrorMessage(
              error,
              "Apps in Toss notification agreement request failed.",
            ),
          }),
        );
      });
    }
  });
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
  requestMessage: string;
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
        path: endpoints.requestMessage,
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
      const payload = await postAppsInTossJson({
        baseUrl,
        body: {
          result: normalizedResult,
          source: source ?? APPS_IN_TOSS_NOTIFICATION_AGREEMENT_SDK_SOURCE,
          status:
            status ?? appsInTossNotificationAgreementStatus(normalizedResult),
          templateCode: normalizeRequiredCode(
            templateCode,
            "REQUEST_NOTIFICATION_AGREEMENT_TEMPLATE_CODE_REQUIRED",
            "Apps in Toss notification agreement templateCode is required.",
          ),
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

async function handleNotificationAgreementFallback({
  createDevFallback,
  error,
  production,
  templateCode,
}: {
  createDevFallback?: AppsInTossNotificationAgreementDevFallback;
  error: unknown;
  production: boolean;
  templateCode: string;
}) {
  if (production || !createDevFallback) {
    throw error;
  }
  const fallback = await createDevFallback({ error, templateCode });
  const result =
    typeof fallback === "string"
      ? fallback
      : normalizeAppsInTossNotificationAgreementResult(fallback.result);
  if (!result) {
    throw new AppsInTossNotificationAgreementError({
      cause: fallback,
      code: "REQUEST_NOTIFICATION_AGREEMENT_INVALID_RESULT",
      message: "Apps in Toss notification agreement fallback was invalid.",
    });
  }
  const fallbackTemplateCode =
    typeof fallback === "string"
      ? templateCode
      : normalizeOptionalCode(fallback.templateCode) ??
        normalizeOptionalCode(fallback.template_code) ??
        templateCode;
  return notificationAgreementPayload(fallbackTemplateCode, result);
}

function notificationAgreementPayload(
  templateCode: string,
  result: AppsInTossNotificationAgreementResult,
): AppsInTossNotificationAgreementPayload {
  return {
    result,
    source: APPS_IN_TOSS_NOTIFICATION_AGREEMENT_SDK_SOURCE,
    status: appsInTossNotificationAgreementStatus(result),
    template_code: templateCode,
    templateCode,
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
