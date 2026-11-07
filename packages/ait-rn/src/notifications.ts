import { normalizeAppsInTossErrorMessage } from "@trailbase-apps-in-toss-kit/trailbase-client";
import {
  AppsInTossNotificationAgreementError,
  appsInTossNotificationAgreementStatus,
  APPS_IN_TOSS_NOTIFICATION_AGREEMENT_SDK_SOURCE,
  normalizeAppsInTossNotificationAgreementResult,
  type AppsInTossNotificationAgreementErrorCode,
  type AppsInTossNotificationAgreementPayload,
  type AppsInTossNotificationAgreementResult,
} from "@trailbase-apps-in-toss-kit/ait-core/notifications";
import {
  defaultFrameworkFunction,
  type AppsInTossRequestNotificationAgreement,
} from "./internal/framework";
import { isProductionEnv, resolveRuntimeEnv } from "./internal/runtime";

// Agreement result types, the error class and the functional message client
// are shared with WebView through ait-core; only the SDK bridge stays here.
export * from "@trailbase-apps-in-toss-kit/ait-core/notifications";
export type { AppsInTossRequestNotificationAgreement } from "./internal/framework";

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
