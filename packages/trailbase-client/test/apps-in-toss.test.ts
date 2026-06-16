import { describe, expect, test } from "bun:test";
import {
  APPS_IN_TOSS_NOTIFICATION_AGREEMENT_SDK_SOURCE,
  AppsInTossNotificationAgreementError,
  AppsInTossStorageUnavailableError,
  createAppsInTossKeyValueStorage,
  createAppsInTossSessionManager,
  createMemoryKeyValueStorage,
  normalizeAppsInTossLoginResult,
  requestAppsInTossLogin,
  requestAppsInTossNotificationAgreement,
} from "../src/apps-in-toss";

describe("AppsInToss client adapters", () => {
  test("reexports login and session helpers from the AppsInToss subpath", () => {
    expect(typeof createAppsInTossSessionManager).toBe("function");
    expect(typeof createAppsInTossKeyValueStorage).toBe("function");
    expect(typeof normalizeAppsInTossLoginResult).toBe("function");
    expect(typeof requestAppsInTossLogin).toBe("function");
  });

  test("wraps Apps in Toss Storage as KeyValueStorage", async () => {
    const nativeStorage = new Map<string, string>();
    const storage = createAppsInTossKeyValueStorage({
      env: "production",
      storage: {
        getItem: (key) => nativeStorage.get(key) ?? null,
        setItem: (key, value) => nativeStorage.set(key, value),
      },
    });

    await storage.setItem("session", "value");
    expect(await storage.getItem("session")).toBe("value");
  });

  test("uses fallback storage only outside production", async () => {
    const fallback = createMemoryKeyValueStorage();
    const storage = createAppsInTossKeyValueStorage({
      env: "test",
      fallbackStorage: fallback,
    });

    await storage.setItem("session", "fallback");
    expect(await storage.getItem("session")).toBe("fallback");
  });

  test("fails in production when Apps in Toss Storage is unavailable", () => {
    expect(() =>
      createAppsInTossKeyValueStorage({
        env: "production",
        fallbackStorage: createMemoryKeyValueStorage(),
      }),
    ).toThrow(AppsInTossStorageUnavailableError);
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
