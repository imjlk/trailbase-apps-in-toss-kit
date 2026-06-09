import { describe, expect, test } from "bun:test";
import {
  APPS_IN_TOSS_NOTIFICATION_AGREEMENT_SDK_SOURCE,
  AppsInTossNotificationAgreementError,
  createAppsInTossSessionManager,
  normalizeAppsInTossLoginResult,
  requestAppsInTossLogin,
  requestAppsInTossNotificationAgreement,
} from "../src/apps-in-toss";

describe("AppsInToss client adapters", () => {
  test("reexports login and session helpers from the AppsInToss subpath", () => {
    expect(typeof createAppsInTossSessionManager).toBe("function");
    expect(typeof normalizeAppsInTossLoginResult).toBe("function");
    expect(typeof requestAppsInTossLogin).toBe("function");
  });

  test("normalizes new notification agreements to OPTED_IN", async () => {
    let cleanupCalls = 0;
    const result = await requestAppsInTossNotificationAgreement({
      templateCode: "ORDER_READY",
      requestNotificationAgreement: ({ onEvent }) => {
        queueMicrotask(() => onEvent({ type: "newAgreement", raw: true }));
        return () => {
          cleanupCalls += 1;
        };
      },
    });

    expect(result).toEqual({
      template_code: "ORDER_READY",
      status: "OPTED_IN",
      result: "newAgreement",
      source: APPS_IN_TOSS_NOTIFICATION_AGREEMENT_SDK_SOURCE,
    });
    expect("providerPayload" in result).toBe(false);
    expect(cleanupCalls).toBe(1);
  });

  test("normalizes existing notification agreements to OPTED_IN", async () => {
    const result = await requestAppsInTossNotificationAgreement({
      templateCode: "ORDER_READY",
      requestNotificationAgreement: ({ onEvent }) => {
        onEvent({ type: "alreadyAgreed" });
        return () => {};
      },
    });

    expect(result.status).toBe("OPTED_IN");
    expect(result.result).toBe("alreadyAgreed");
  });

  test("normalizes rejected notification agreements to OPTED_OUT", async () => {
    const result = await requestAppsInTossNotificationAgreement({
      templateCode: "ORDER_READY",
      requestNotificationAgreement: ({ onEvent }) => {
        onEvent({ type: "agreementRejected" });
        return () => {};
      },
    });

    expect(result.status).toBe("OPTED_OUT");
    expect(result.result).toBe("agreementRejected");
  });

  test("cleans up and rejects with a user-facing message on SDK errors", async () => {
    let cleanupCalls = 0;

    await expect(
      requestAppsInTossNotificationAgreement({
        templateCode: "ORDER_READY",
        requestNotificationAgreement: ({ onError }) => {
          queueMicrotask(() => onError({ error: { message: "브릿지 오류" } }));
          return () => {
            cleanupCalls += 1;
          };
        },
      }),
    ).rejects.toThrow(AppsInTossNotificationAgreementError);

    await expect(
      requestAppsInTossNotificationAgreement({
        templateCode: "ORDER_READY",
        requestNotificationAgreement: ({ onError }) => {
          onError({ error: { message: "브릿지 오류" } });
        },
      }),
    ).rejects.toThrow("브릿지 오류");
    expect(cleanupCalls).toBe(1);
  });

  test("rejects unknown notification agreement event types", async () => {
    await expect(
      requestAppsInTossNotificationAgreement({
        templateCode: "ORDER_READY",
        requestNotificationAgreement: ({ onEvent }) => {
          onEvent({ type: "unknownAgreement" });
          return () => {};
        },
      }),
    ).rejects.toThrow("알림 동의 결과를 확인하지 못했어요.");
  });
});
