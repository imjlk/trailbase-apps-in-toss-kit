import { normalizeAppsInTossErrorMessage } from "./index";

export {
  createAppsInTossSessionManager,
  normalizeAppsInTossErrorMessage,
  normalizeAppsInTossLoginResult,
  normalizeAppsInTossReferrer,
  requestAppsInTossLogin,
} from "./index";

export const APPS_IN_TOSS_NOTIFICATION_AGREEMENT_SDK_SOURCE = "apps_in_toss_sdk";

export type AppsInTossNotificationAgreementResult =
  | "newAgreement"
  | "alreadyAgreed"
  | "agreementRejected";

export type AppsInTossNotificationAgreementStatus = "OPTED_IN" | "OPTED_OUT";

export interface AppsInTossNotificationAgreementResultPayload {
  template_code: string;
  status: AppsInTossNotificationAgreementStatus;
  result: AppsInTossNotificationAgreementResult;
  source: typeof APPS_IN_TOSS_NOTIFICATION_AGREEMENT_SDK_SOURCE;
  providerPayload: unknown;
}

export interface AppsInTossNotificationAgreementRequestOptions {
  requestNotificationAgreement: AppsInTossRequestNotificationAgreement;
  templateCode: string;
}

export type AppsInTossRequestNotificationAgreement = (params: {
  options: { templateCode: string };
  onEvent: (event: unknown) => void;
  onError: (error: unknown) => void | Promise<void>;
}) => void | (() => void);

export class AppsInTossNotificationAgreementError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AppsInTossNotificationAgreementError";
  }
}

export function requestAppsInTossNotificationAgreement({
  requestNotificationAgreement,
  templateCode,
}: AppsInTossNotificationAgreementRequestOptions): Promise<AppsInTossNotificationAgreementResultPayload> {
  const normalizedTemplateCode = templateCode.trim();
  if (!normalizedTemplateCode) {
    return Promise.reject(
      new AppsInTossNotificationAgreementError("알림 동의문 코드를 확인하지 못했어요."),
    );
  }

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
        // The SDK cleanup is best-effort listener disposal and should not hide the result.
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
      callback({ resolve, reject });
    };

    try {
      const returnedCleanup = requestNotificationAgreement({
        options: { templateCode: normalizedTemplateCode },
        onEvent: (event) => {
          const result = notificationAgreementResultFromEvent(event);
          complete(({ resolve, reject }) => {
            if (!result) {
              reject(
                new AppsInTossNotificationAgreementError(
                  "알림 동의 결과를 확인하지 못했어요.",
                ),
              );
              return;
            }
            resolve({
              template_code: normalizedTemplateCode,
              status: notificationAgreementStatus(result),
              result,
              source: APPS_IN_TOSS_NOTIFICATION_AGREEMENT_SDK_SOURCE,
              providerPayload: event,
            });
          });
        },
        onError: (error) => {
          complete(({ reject }) => {
            reject(
              new AppsInTossNotificationAgreementError(
                normalizeAppsInTossErrorMessage(error, "알림 동의 요청을 완료하지 못했어요."),
              ),
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
          new AppsInTossNotificationAgreementError(
            normalizeAppsInTossErrorMessage(error, "알림 동의 요청을 완료하지 못했어요."),
          ),
        );
      });
    }
  });
}

function notificationAgreementResultFromEvent(
  event: unknown,
): AppsInTossNotificationAgreementResult | null {
  if (!event || typeof event !== "object") {
    return null;
  }
  const type = (event as Record<string, unknown>).type;
  if (
    type === "newAgreement" ||
    type === "alreadyAgreed" ||
    type === "agreementRejected"
  ) {
    return type;
  }
  return null;
}

function notificationAgreementStatus(
  result: AppsInTossNotificationAgreementResult,
): AppsInTossNotificationAgreementStatus {
  return result === "agreementRejected" ? "OPTED_OUT" : "OPTED_IN";
}
