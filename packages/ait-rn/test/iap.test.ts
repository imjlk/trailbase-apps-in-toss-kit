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

  test("settles purchase promises when SDK cleanup throws", async () => {
    const cleanupError = new Error("cleanup failed");
    const createOneTimePurchaseOrder: AppsInTossIapCreateOneTimePurchaseOrder =
      ({ onEvent, options }) => {
        void options.processProductGrant({ orderId: "order-1" }).then(() => {
          onEvent({
            data: { orderId: "order-1" },
            type: "success",
          });
        });
        return () => {
          throw cleanupError;
        };
      };
    const bridge = createAppsInTossIapBridge({
      IAP: { createOneTimePurchaseOrder },
    });

    await expect(
      bridge.purchaseOneTime({
        processProductGrant: () => true,
        sku: "coins.100",
      }),
    ).resolves.toMatchObject({
      orderId: "order-1",
      sku: "coins.100",
    });
  });

  test("waits for product grant before resolving early purchase success events", async () => {
    let resolveGrant: (() => void) | undefined;
    let purchaseSettled = false;
    const createOneTimePurchaseOrder: AppsInTossIapCreateOneTimePurchaseOrder =
      ({ onEvent, options }) => {
        void options.processProductGrant({ orderId: "order-1" });
        onEvent({
          data: { orderId: "order-1" },
          type: "success",
        });
        return () => undefined;
      };
    const bridge = createAppsInTossIapBridge({
      IAP: { createOneTimePurchaseOrder },
    });

    const purchase = bridge.purchaseOneTime({
      processProductGrant: () =>
        new Promise<boolean>((resolve) => {
          resolveGrant = () => resolve(true);
        }),
      sku: "coins.100",
    });
    void purchase.then(() => {
      purchaseSettled = true;
    });

    await Promise.resolve();
    expect(purchaseSettled).toBe(false);

    resolveGrant?.();
    await expect(purchase).resolves.toMatchObject({
      orderId: "order-1",
      sku: "coins.100",
    });
    await Promise.resolve();
    expect(purchaseSettled).toBe(true);
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

  test("rejects explicit product grant denial responses", async () => {
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
    });

    await expect(
      bridge.purchaseOneTime({
        processProductGrant: () => ({ granted: false, ok: true }),
        sku: "coins.100",
      }),
    ).rejects.toMatchObject({ code: "IAP_PRODUCT_GRANT_FAILED" });
    expect(cleanupCalls).toBe(1);
  });

  test("does not install a hard checkout timeout by default", async () => {
    const originalSetTimeout = globalThis.setTimeout;
    const originalClearTimeout = globalThis.clearTimeout;
    let timeoutCalls = 0;
    globalThis.setTimeout = ((..._args: Parameters<typeof setTimeout>) => {
      timeoutCalls += 1;
      return 0 as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout;
    globalThis.clearTimeout = (() => undefined) as typeof clearTimeout;

    try {
      const bridge = createAppsInTossIapBridge({
        IAP: {
          createOneTimePurchaseOrder: ({ onError }) => {
            onError(new Error("purchase canceled"));
            return () => undefined;
          },
        },
      });

      await expect(
        bridge.purchaseOneTime({
          processProductGrant: () => true,
          sku: "coins.100",
        }),
      ).rejects.toThrow("Apps in Toss one-time purchase failed.");
      expect(timeoutCalls).toBe(0);
    } finally {
      globalThis.setTimeout = originalSetTimeout;
      globalThis.clearTimeout = originalClearTimeout;
    }
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

  test("preserves restored order success when the completion hook throws", async () => {
    const hookError = new Error("cache write failed");
    const bridge = createAppsInTossIapBridge({
      IAP: {
        completeProductGrant: async () => true,
        getPendingOrders: async () => ({
          orders: [{ orderId: "order-1", sku: "coins.100" }],
        }),
      },
    });

    const result = await bridge.restorePendingOrders({
      onProductGrantCompleted: () => {
        throw hookError;
      },
      processProductGrant: () => true,
    });

    expect(result.restored).toHaveLength(1);
    expect(result.failed).toHaveLength(0);
    expect(result.results[0]).toMatchObject({
      completed: true,
      granted: true,
      hookError,
      order: { orderId: "order-1", sku: "coins.100" },
    });
  });

  test("preserves grant state when pending order completion fails", async () => {
    const completionError = new Error("completion failed");
    const bridge = createAppsInTossIapBridge({
      IAP: {
        completeProductGrant: async () => {
          throw completionError;
        },
        getPendingOrders: async () => ({
          orders: [{ orderId: "order-1", sku: "coins.100" }],
        }),
      },
    });

    const result = await bridge.restorePendingOrders({
      processProductGrant: () => true,
    });

    expect(result.restored).toHaveLength(0);
    expect(result.failed).toHaveLength(1);
    expect(result.results[0]).toMatchObject({
      completed: false,
      error: completionError,
      granted: true,
      order: { orderId: "order-1", sku: "coins.100" },
    });
  });

  test("classifies deferred restore completion as restored instead of failed", async () => {
    let completeCalls = 0;
    const bridge = createAppsInTossIapBridge({
      IAP: {
        completeProductGrant: async () => {
          completeCalls += 1;
          return true;
        },
        getPendingOrders: async () => ({
          orders: [{ orderId: "order-1", sku: "coins.100" }],
        }),
      },
    });

    const result = await bridge.restorePendingOrders({
      completeAfterGrant: false,
      processProductGrant: () => true,
    });

    expect(result.restored).toHaveLength(1);
    expect(result.failed).toHaveLength(0);
    expect(result.results[0]).toMatchObject({
      completed: false,
      completionDeferred: true,
      granted: true,
    });
    expect(completeCalls).toBe(0);
  });

  test("normalizes SDK errors into user-facing bridge errors", async () => {
    const bridge = createAppsInTossIapBridge({
      IAP: {
        createOneTimePurchaseOrder: ({ onError }) => {
          onError({ error: { message: "raw-toss-user-key-secret" } });
          return () => undefined;
        },
      },
    });

    try {
      await bridge.purchaseOneTime({
        processProductGrant: () => true,
        sku: "coins.100",
      });
      throw new Error("Expected purchase to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(AppsInTossIapBridgeError);
      expect((error as Error).message).toBe(
        "Apps in Toss one-time purchase failed.",
      );
      expect((error as Error).message).not.toContain("raw-toss-user-key-secret");
    }
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
