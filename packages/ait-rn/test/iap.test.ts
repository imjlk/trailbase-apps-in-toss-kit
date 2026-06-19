import { describe, expect, test } from "bun:test";
import {
  AppsInTossIapBridgeError,
  createAppsInTossIapBridge,
  createAppsInTossIapGrantClient,
  type AppsInTossIapCreateOneTimePurchaseOrder,
  type AppsInTossIapSdk,
} from "../src/iap";

describe("AppsInToss IAP bridge", () => {
  test("normalizes product lists from the SDK", async () => {
    const bridge = createAppsInTossIapBridge({
      IAP: {
        getProductItemList: async () => ({
          products: [
            {
              description: "Coins",
              displayAmount: "1,000 won",
              displayName: "Coin pack",
              iconUrl: "https://example.test/coin.png",
              sku: " coins.100 ",
            },
          ],
        }),
      },
    });

    await expect(bridge.getProducts()).resolves.toEqual([
      {
        description: "Coins",
        displayAmount: "1,000 won",
        displayName: "Coin pack",
        iconUrl: "https://example.test/coin.png",
        sku: "coins.100",
      },
    ]);
  });

  test("purchases one-time products, runs product grant, and cleans up once", async () => {
    let cleanupCalls = 0;
    const createOneTimePurchaseOrder: AppsInTossIapCreateOneTimePurchaseOrder =
      ({ onEvent, options }) => {
        void options.processProductGrant({ orderId: " order-1 " }).then(() => {
          onEvent({
            data: {
              amount: 1000,
              currency: "KRW",
              orderId: " order-1 ",
            },
            type: "success",
          });
        });
        return () => {
          cleanupCalls += 1;
        };
      };
    const bridge = createAppsInTossIapBridge({
      IAP: { createOneTimePurchaseOrder },
    });

    const grants: unknown[] = [];
    const result = await bridge.purchaseOneTime({
      processProductGrant: (input) => {
        grants.push(input);
        return { granted: true };
      },
      sku: " coins.100 ",
    });

    expect(result).toMatchObject({
      amount: 1000,
      currency: "KRW",
      orderId: "order-1",
      sku: "coins.100",
    });
    expect(grants).toEqual([
      {
        orderId: "order-1",
        providerPayload: { orderId: " order-1 " },
        sku: "coins.100",
        source: "purchase",
      },
    ]);
    expect(cleanupCalls).toBe(1);
  });

  test("rejects and cleans up when product grant times out", async () => {
    let cleanupCalls = 0;
    const createOneTimePurchaseOrder: AppsInTossIapCreateOneTimePurchaseOrder =
      ({ options }) => {
        void options.processProductGrant({ orderId: "order-1" });
        return () => {
          cleanupCalls += 1;
        };
      };
    const bridge = createAppsInTossIapBridge({
      IAP: { createOneTimePurchaseOrder },
      processProductGrantTimeoutMs: 1,
      purchaseTimeoutMs: 100,
    });

    await expect(
      bridge.purchaseOneTime({
        processProductGrant: () => new Promise(() => undefined),
        sku: "coins.100",
      }),
    ).rejects.toMatchObject({ code: "IAP_PRODUCT_GRANT_TIMEOUT" });
    expect(cleanupCalls).toBe(1);
  });

  test("fails closed when the SDK or method is unavailable or unsupported", async () => {
    const missingBridge = createAppsInTossIapBridge({ IAP: undefined });
    await expect(missingBridge.getProducts()).rejects.toMatchObject({
      code: "IAP_SDK_UNAVAILABLE",
    });

    const unsupportedGetProducts = Object.assign(
      async () => ({ products: [] }),
      { isSupported: () => false },
    );
    const unsupportedBridge = createAppsInTossIapBridge({
      IAP: { getProductItemList: unsupportedGetProducts },
    });

    await expect(unsupportedBridge.getProducts()).rejects.toMatchObject({
      code: "IAP_GET_PRODUCTS_UNSUPPORTED",
    });
  });

  test("restores pending orders and completes product grant after server grant", async () => {
    const completedOrderIds: string[] = [];
    const completedBackend: unknown[] = [];
    const IAP: AppsInTossIapSdk = {
      completeProductGrant: async ({ params }) => {
        completedOrderIds.push(params.orderId);
        return true;
      },
      getPendingOrders: async () => ({
        orders: [
          {
            orderId: "order-1",
            paymentCompletedDate: "2026-06-19T10:00:00",
            sku: "coins.100",
          },
        ],
      }),
    };
    const bridge = createAppsInTossIapBridge({ IAP });

    const result = await bridge.restorePendingOrders({
      onProductGrantCompleted: (input) => {
        completedBackend.push(input);
      },
      processProductGrant: () => true,
    });

    expect(result.restored).toHaveLength(1);
    expect(result.failed).toHaveLength(0);
    expect(completedOrderIds).toEqual(["order-1"]);
    expect(completedBackend).toEqual([
      {
        orderId: "order-1",
        providerPayload: {
          orderId: "order-1",
          paymentCompletedDate: "2026-06-19T10:00:00",
          sku: "coins.100",
        },
        sku: "coins.100",
        source: "restore",
      },
    ]);
  });

  test("normalizes SDK errors into user-facing bridge errors", async () => {
    const bridge = createAppsInTossIapBridge({
      IAP: {
        createOneTimePurchaseOrder: ({ onError }) => {
          onError({ error: { message: "purchase canceled" } });
          return () => undefined;
        },
      },
    });

    await expect(
      bridge.purchaseOneTime({
        processProductGrant: () => true,
        sku: "coins.100",
      }),
    ).rejects.toThrow(AppsInTossIapBridgeError);
    await expect(
      bridge.purchaseOneTime({
        processProductGrant: () => true,
        sku: "coins.100",
      }),
    ).rejects.toThrow("purchase canceled");
  });
});

describe("AppsInToss IAP grant client", () => {
  test("posts grant, complete, and pending requests to app-owned endpoints", async () => {
    const calls: Array<{ body: unknown; headers: HeadersInit | undefined; url: string }> =
      [];
    const client = createAppsInTossIapGrantClient({
      baseUrl: "https://api.example.test",
      endpoints: {
        completeEndpoint: "/iap/complete",
        grantEndpoint: "/iap/grant",
        pendingEndpoint: "/iap/pending",
      },
      fetcher: async (url, init) => {
        calls.push({
          body: JSON.parse(String(init.body)),
          headers: init.headers,
          url,
        });
        return Response.json({ ok: true, granted: true });
      },
      getAuthHeaders: () => ({ Authorization: "Bearer session-token" }),
    });

    await client.grant({
      orderId: " order-1 ",
      providerPayload: { source: "sdk" },
      requestId: "request-1",
      sku: " coins.100 ",
      source: "purchase",
    });
    await client.complete({ orderId: "order-1", sku: "coins.100" });
    await client.pending({ orders: [{ orderId: "order-2", sku: "coins.200" }] });

    expect(calls).toEqual([
      {
        body: {
          orderId: "order-1",
          providerPayload: { source: "sdk" },
          requestId: "request-1",
          sku: "coins.100",
          source: "purchase",
        },
        headers: {
          Authorization: "Bearer session-token",
          "Content-Type": "application/json",
        },
        url: "https://api.example.test/iap/grant",
      },
      {
        body: {
          orderId: "order-1",
          sku: "coins.100",
        },
        headers: {
          Authorization: "Bearer session-token",
          "Content-Type": "application/json",
        },
        url: "https://api.example.test/iap/complete",
      },
      {
        body: {
          orders: [{ orderId: "order-2", sku: "coins.200" }],
        },
        headers: {
          Authorization: "Bearer session-token",
          "Content-Type": "application/json",
        },
        url: "https://api.example.test/iap/pending",
      },
    ]);
  });

  test("exports the IAP subpath", async () => {
    const module = await import("../src/iap");
    expect(module.createAppsInTossIapBridge).toBeFunction();
    expect(module.createAppsInTossIapGrantClient).toBeFunction();
  });
});
