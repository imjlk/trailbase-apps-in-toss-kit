import { afterAll, describe, expect, mock, test } from "bun:test";
import { createAppsInTossFullScreenAdBridge } from "../src/ads";
import { resolveAppsInTossAnonymousHash } from "../src/identity";
import { createAppsInTossIapBridge } from "../src/iap";
import { createAppsInTossLoginBridge } from "../src/login";
import type {
  AppsInTossIapCreateOneTimePurchaseOrder,
  AppsInTossIapGetPendingOrders,
  AppsInTossLoadFullScreenAd,
  AppsInTossShowFullScreenAd,
} from "../src/iap";

/**
 * Default-loader coverage: these tests replace `@apps-in-toss/framework`
 * itself (the module the @ait-kit/sdk default loaders import) instead of
 * injecting replacement functions into the kit. They pin the connection
 * through the real delegation path — official flat exports, adapter
 * conversion, settle-once flow, and error mapping — without claiming any
 * real Toss app behavior.
 *
 * Bun snapshots a mocked module's namespace at first import, so the mock
 * exposes stable wrapper functions that delegate to a mutable provider
 * record: sdk adapters convert the module once, but every call re-reads
 * the current provider through the wrappers. Capability gates
 * (`isSupported`) read the provider the same way, letting individual
 * tests disable one capability without re-mocking the module.
 */
type Provider = {
  appLogin?: () => Promise<{ authorizationCode: string; referrer: string }>;
  appLoginSupported?: boolean;
  getAnonymousKey?: () => Promise<unknown>;
  getAnonymousKeySupported?: boolean;
  loadFullScreenAd?: AppsInTossLoadFullScreenAd;
  loadAdSupported?: boolean;
  showFullScreenAd?: AppsInTossShowFullScreenAd;
  showAdSupported?: boolean;
  IAP?: {
    createOneTimePurchaseOrder?: AppsInTossIapCreateOneTimePurchaseOrder;
    getPendingOrders?: AppsInTossIapGetPendingOrders;
  };
};

const provider: { current: Provider } = { current: {} };

// The mock.module replacement lives for the whole test process; clearing the
// provider afterwards makes any later accidental default-path use fail
// loudly instead of silently serving this file's leftovers.
afterAll(() => {
  provider.current = {};
});

/**
 * The sdk default loaders acquire the (mocked) official module
 * asynchronously, so provider registration lands a few ticks after the
 * bridge call returns. A macrotask boundary flushes those hops.
 */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function delegate<T extends (...args: never[]) => unknown>(
  key: keyof Provider,
  supportedKey: keyof Provider,
) {
  return Object.assign(
    (...args: Parameters<T>) =>
      (provider.current[key] as T | undefined)!(...args),
    {
      isSupported: () => provider.current[supportedKey] !== false,
    },
  ) as T & { isSupported?: () => boolean };
}

function delegateIap<T extends (...args: never[]) => unknown>(
  key: "createOneTimePurchaseOrder" | "getPendingOrders",
) {
  return Object.assign((...args: Parameters<T>) => {
    const iap = provider.current.IAP;
    return (iap?.[key] as T | undefined)!(...args);
  }) as T;
}

mock.module("@apps-in-toss/framework", () => ({
  appLogin: delegate<() => Promise<{ authorizationCode: string; referrer: string }>>(
    "appLogin",
    "appLoginSupported",
  ),
  getAnonymousKey: delegate<() => Promise<unknown>>(
    "getAnonymousKey",
    "getAnonymousKeySupported",
  ),
  loadFullScreenAd: delegate<AppsInTossLoadFullScreenAd>(
    "loadFullScreenAd",
    "loadAdSupported",
  ),
  showFullScreenAd: delegate<AppsInTossShowFullScreenAd>(
    "showFullScreenAd",
    "showAdSupported",
  ),
  IAP: {
    createOneTimePurchaseOrder: delegateIap<AppsInTossIapCreateOneTimePurchaseOrder>(
      "createOneTimePurchaseOrder",
    ),
    getPendingOrders: delegateIap<AppsInTossIapGetPendingOrders>(
      "getPendingOrders",
    ),
  },
}));

describe("default loader connections through @ait-kit/sdk", () => {
  test("RN appLogin reaches the official module through the sdk identity adapter", async () => {
    provider.current = {
      appLogin: async () => ({
        authorizationCode: "auth-code-1",
        referrer: "SANDBOX",
      }),
    };
    const bridge = createAppsInTossLoginBridge({ production: true });
    await expect(bridge.appLogin()).resolves.toEqual({
      authorizationCode: "auth-code-1",
      referrer: "SANDBOX",
    });
  });

  test("RN appLogin fail-closed in production and falls back in dev when unsupported", async () => {
    provider.current = { appLoginSupported: false };
    const productionBridge = createAppsInTossLoginBridge({ production: true });
    await expect(productionBridge.appLogin()).rejects.toMatchObject({
      code: "APP_LOGIN_UNAVAILABLE",
    });

    const devBridge = createAppsInTossLoginBridge({ production: false });
    const result = await devBridge.appLogin();
    expect(result.referrer).toBe("SANDBOX");
    expect(result.authorizationCode).toMatch(/^dev-auth/);
  });

  test("RN getAnonymousKey default path normalizes and prefixes the official hash", async () => {
    provider.current = {
      getAnonymousKey: async () => ({ type: "HASH", hash: "hash-1" }),
    };
    await expect(
      resolveAppsInTossAnonymousHash({ production: true }),
    ).resolves.toBe("ait:hash-1");
  });

  test("RN getAnonymousKey below-minimum sentinel surfaces as unsupported in production", async () => {
    provider.current = {
      getAnonymousKey: async () => undefined,
    };
    await expect(
      resolveAppsInTossAnonymousHash({ production: true }),
    ).rejects.toMatchObject({ code: "ANONYMOUS_KEY_UNSUPPORTED" });
  });

  test("full-screen ad load delegates to the official module and maps sdk errors", async () => {
    const loadCalls: Array<{
      onError: (error: unknown) => void;
      onEvent: (event: { type: "loaded" }) => void;
    }> = [];
    provider.current = {
      loadFullScreenAd: Object.assign(
        ({ onError, onEvent }) => {
          loadCalls.push({ onError, onEvent });
          return () => undefined;
        },
        { isSupported: () => true },
      ) as AppsInTossLoadFullScreenAd,
    };
    const bridge = createAppsInTossFullScreenAdBridge({ loadTimeoutMs: 1_000 });

    const failed = bridge.preload({ adGroupId: "rewarded" });
    await flush();
    loadCalls[0].onError(new Error("no fill"));
    await expect(failed).rejects.toMatchObject({ code: "AD_LOAD_FAILED" });

    // An immediate retry (no await/sleep between failures) must reach the
    // provider again instead of reusing the failed registration.
    const retried = bridge.preload({ adGroupId: "rewarded" });
    await flush();
    expect(loadCalls).toHaveLength(2);
    loadCalls[1].onEvent({ type: "loaded" });
    await expect(retried).resolves.toBeUndefined();
  });

  test("load completion is followed by a local show using the official show function", async () => {
    const loadCalls: Array<{
      onEvent: (event: { type: "loaded" }) => void;
    }> = [];
    const showCalls: Array<{
      onEvent: (event: { type: string; data?: unknown }) => void;
    }> = [];
    provider.current = {
      loadFullScreenAd: Object.assign(
        ({ onEvent }) => {
          loadCalls.push({ onEvent });
          return () => undefined;
        },
        { isSupported: () => true },
      ) as AppsInTossLoadFullScreenAd,
      showFullScreenAd: Object.assign(
        ({ onEvent }) => {
          showCalls.push({ onEvent });
          return () => undefined;
        },
        { isSupported: () => true },
      ) as unknown as AppsInTossShowFullScreenAd,
    };
    const bridge = createAppsInTossFullScreenAdBridge({ loadTimeoutMs: 1_000 });

    const loaded = bridge.preload({ adGroupId: "rewarded" });
    await flush();
    loadCalls[0].onEvent({ type: "loaded" });
    await expect(loaded).resolves.toBeUndefined();

    const shown = bridge.show({ adFormat: "rewarded", adGroupId: "rewarded" });
    await flush();
    showCalls[0].onEvent({ type: "userEarnedReward", data: { unitAmount: 3, unitType: "coin" } });
    showCalls[0].onEvent({ type: "dismissed" });
    // A late duplicate settlement attempt after the show resolved must not
    // affect the already-returned result.
    showCalls[0].onEvent({ type: "failedToShow" });
    const result = await shown;
    expect(result).toMatchObject({
      adFormat: "rewarded",
      adGroupId: "rewarded",
      completed: true,
      earned: true,
      unitAmount: 3,
      unitType: "coin",
    });
  });

  test("one-time purchase connects the grant callback, success event, and result mapping", async () => {
    const orderCalls: Array<{
      options: {
        processProductGrant: (params: { orderId: string }) => Promise<boolean>;
      };
      onEvent: (event: { type: string; data?: unknown }) => void;
      onError: (error: unknown) => void;
    }> = [];
    let grantCalls = 0;
    provider.current = {
      IAP: {
        createOneTimePurchaseOrder: Object.assign(
          ({ options, onEvent, onError }) => {
            orderCalls.push({ options, onEvent, onError });
            queueMicrotask(() => {
              void options
                .processProductGrant({ orderId: "order-1" })
                .then((granted) => {
                  if (granted) {
                    onEvent({
                      type: "success",
                      data: { orderId: "order-1", sku: "sku-1", amount: 1000 },
                    });
                  }
                })
                .catch(onError);
            });
            return () => undefined;
          },
          { isSupported: () => true },
        ) as AppsInTossIapCreateOneTimePurchaseOrder,
      },
    };
    const bridge = createAppsInTossIapBridge();
    const result = await bridge.purchaseOneTime({
      processProductGrant: async () => {
        grantCalls += 1;
        return true;
      },
      sku: "sku-1",
    });
    expect(result).toMatchObject({
      orderId: "order-1",
      sku: "sku-1",
      amount: 1000,
    });
    expect(grantCalls).toBe(1);
  });

  test("a success event for a different order than the granted one fails the purchase", async () => {
    const orderCalls: Array<{
      options: {
        processProductGrant: (params: { orderId: string }) => Promise<boolean>;
      };
      onEvent: (event: { type: string; data?: unknown }) => void;
    }> = [];
    provider.current = {
      IAP: {
        createOneTimePurchaseOrder: Object.assign(
          ({ options, onEvent }) => {
            orderCalls.push({ options, onEvent });
            queueMicrotask(() => {
              void options
                .processProductGrant({ orderId: "order-a" })
                .then((granted) => {
                  if (granted) {
                    onEvent({
                      type: "success",
                      data: { orderId: "order-b", sku: "sku-1" },
                    });
                  }
                });
            });
            return () => undefined;
          },
          { isSupported: () => true },
        ) as AppsInTossIapCreateOneTimePurchaseOrder,
      },
    };
    const bridge = createAppsInTossIapBridge();
    await expect(
      bridge.purchaseOneTime({
        processProductGrant: async () => true,
        sku: "sku-1",
      }),
    ).rejects.toMatchObject({ code: "IAP_PURCHASE_FAILED" });
  });

  test("repeated grant callbacks for the same order do not duplicate the server grant", async () => {
    provider.current = {
      IAP: {
        createOneTimePurchaseOrder: Object.assign(
          ({ options, onEvent }) => {
            queueMicrotask(async () => {
              const first = options.processProductGrant({ orderId: "order-1" });
              const duplicate = options.processProductGrant({ orderId: "order-1" });
              expect(await Promise.all([first, duplicate])).toEqual([true, true]);
              onEvent({
                type: "success",
                data: { orderId: "order-1", sku: "sku-1" },
              });
            });
            return () => undefined;
          },
          { isSupported: () => true },
        ) as AppsInTossIapCreateOneTimePurchaseOrder,
      },
    };
    const bridge = createAppsInTossIapBridge();
    let serverGrants = 0;
    await expect(
      bridge.purchaseOneTime({
        processProductGrant: async () => {
          serverGrants += 1;
          return true;
        },
        sku: "sku-1",
      }),
    ).resolves.toMatchObject({ orderId: "order-1" });
    expect(serverGrants).toBe(1);
  });

  test("pending-order listing runs through the sdk adapter default path", async () => {
    provider.current = {
      IAP: {
        getPendingOrders: Object.assign(
          async () => ({
            orders: [
              {
                orderId: "pending-1",
                paymentCompletedDate: "2026-09-17T00:00:00Z",
                sku: "sku-1",
              },
            ],
          }),
          { isSupported: () => true },
        ) as AppsInTossIapGetPendingOrders,
      },
    };
    const bridge = createAppsInTossIapBridge();
    // Completion after the server grant would need the platform's
    // completeProductGrant member as well; this test pins only the
    // delegated pending-order listing path.
    const result = await bridge.restorePendingOrders({
      completeAfterGrant: false,
      processProductGrant: async () => true,
    });
    expect(result.orders).toEqual([
      {
        orderId: "pending-1",
        paymentCompletedDate: "2026-09-17T00:00:00Z",
        sku: "sku-1",
      },
    ]);
    expect(result.restored).toHaveLength(1);
  });
});
