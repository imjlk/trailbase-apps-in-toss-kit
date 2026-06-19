import { describe, expect, test } from "bun:test";
import {
  APPS_IN_TOSS_NOTIFICATION_AGREEMENT_SDK_SOURCE,
  AppsInTossNotificationAgreementError,
  createAppsInTossFunctionalMessageClient,
  createAppsInTossNotificationAgreementBridge,
  requestAppsInTossNotificationAgreement,
  type AppsInTossRequestNotificationAgreement,
} from "../src/notifications";

describe("AppsInToss notification helpers", () => {
  test("normalizes notification agreement SDK events and cleans up once", async () => {
    let cleanupCalls = 0;
    const requestNotificationAgreement: AppsInTossRequestNotificationAgreement =
      ({ onEvent }) => {
        onEvent({ type: "newAgreement", raw: true });
        return () => {
          cleanupCalls += 1;
        };
      };

    const result = await requestAppsInTossNotificationAgreement({
      requestNotificationAgreement,
      templateCode: " order-ready ",
    });

    expect(result).toEqual({
      result: "newAgreement",
      source: APPS_IN_TOSS_NOTIFICATION_AGREEMENT_SDK_SOURCE,
      status: "OPTED_IN",
      template_code: "order-ready",
      templateCode: "order-ready",
    });
    expect(cleanupCalls).toBe(1);
  });

  test("maps existing and rejected agreements to persisted statuses", async () => {
    const existing = await requestAppsInTossNotificationAgreement({
      requestNotificationAgreement: ({ onEvent }) => {
        queueMicrotask(() => onEvent({ type: "alreadyAgreed" }));
        return () => {};
      },
      templateCode: "ORDER_READY",
    });
    const rejected = await requestAppsInTossNotificationAgreement({
      requestNotificationAgreement: ({ onEvent }) => {
        queueMicrotask(() => onEvent({ type: "agreementRejected" }));
        return () => {};
      },
      templateCode: "ORDER_READY",
    });

    expect(existing.status).toBe("OPTED_IN");
    expect(rejected.status).toBe("OPTED_OUT");
  });

  test("cleans up once on SDK errors and thrown SDK calls", async () => {
    let cleanupCalls = 0;
    await expect(
      requestAppsInTossNotificationAgreement({
        requestNotificationAgreement: ({ onError }) => {
          queueMicrotask(() => onError({ error: { message: "bridge failed" } }));
          return () => {
            cleanupCalls += 1;
          };
        },
        templateCode: "ORDER_READY",
      }),
    ).rejects.toThrow(AppsInTossNotificationAgreementError);
    expect(cleanupCalls).toBe(1);

    await expect(
      requestAppsInTossNotificationAgreement({
        requestNotificationAgreement: () => {
          throw new Error("sdk exploded");
        },
        templateCode: "ORDER_READY",
      }),
    ).rejects.toThrow("sdk exploded");
  });

  test("fails closed in production and allows explicit dev fallback outside production", async () => {
    const productionBridge = createAppsInTossNotificationAgreementBridge({
      production: true,
    });
    await expect(
      productionBridge.requestAgreement({ templateCode: "ORDER_READY" }),
    ).rejects.toMatchObject({
      code: "REQUEST_NOTIFICATION_AGREEMENT_UNAVAILABLE",
    });

    const devBridge = createAppsInTossNotificationAgreementBridge({
      createDevFallback: () => "alreadyAgreed",
      production: false,
    });
    await expect(
      devBridge.requestAgreement({ templateCode: "ORDER_READY" }),
    ).resolves.toMatchObject({
      result: "alreadyAgreed",
      status: "OPTED_IN",
      templateCode: "ORDER_READY",
    });
  });

  test("posts functional message agreement and request payloads to app backend", async () => {
    const calls: Array<{
      body: unknown;
      headers: HeadersInit | undefined;
      url: string;
    }> = [];
    const client = createAppsInTossFunctionalMessageClient({
      baseUrl: "https://api.example.test",
      endpoints: {
        requestMessage: "/api/app/v1/messages/request",
        syncAgreement: "/api/app/v1/notification-agreements",
      },
      fetcher: async (url, init) => {
        calls.push({
          body: JSON.parse(String(init.body)),
          headers: init.headers,
          url,
        });
        return Response.json({ ok: true });
      },
      getAuthHeaders: () => ({ Authorization: "Bearer session-token" }),
    });

    await client.syncAgreement({
      result: "newAgreement",
      templateCode: "mission-status-agreement",
    });
    await client.requestMessage({
      agreementTemplateCode: "mission-status-agreement",
      context: { correctCount: 2 },
      providerRequestId: "message-1",
      templateSetCode: "mission-status-2",
    });

    expect(calls).toEqual([
      {
        body: {
          result: "newAgreement",
          source: "apps_in_toss_sdk",
          status: "OPTED_IN",
          templateCode: "mission-status-agreement",
        },
        headers: {
          Authorization: "Bearer session-token",
          "Content-Type": "application/json",
        },
        url: "https://api.example.test/api/app/v1/notification-agreements",
      },
      {
        body: {
          agreementTemplateCode: "mission-status-agreement",
          context: { correctCount: 2 },
          providerRequestId: "message-1",
          templateSetCode: "mission-status-2",
        },
        headers: {
          Authorization: "Bearer session-token",
          "Content-Type": "application/json",
        },
        url: "https://api.example.test/api/app/v1/messages/request",
      },
    ]);
  });
});
