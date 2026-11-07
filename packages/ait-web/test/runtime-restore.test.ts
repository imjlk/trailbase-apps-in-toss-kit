import { describe, expect, test } from "bun:test";
import * as rnDiagnostics from "../../ait-rn/src/diagnostics";
import * as rnIap from "../../ait-rn/src/iap";
import * as rnRuntime from "../../ait-rn/src/runtime";
import * as webAds from "../src/ads";
import { collectAppsInTossRuntimeDiagnostics } from "../src/diagnostics";
import {
  AppsInTossIapBridgeError,
  createAppsInTossIapRestoreBridge,
  type AppsInTossIapProductGrantInput,
  type AppsInTossIapRestorePendingOrdersResult,
} from "../src/iap";
import * as webRoot from "../src/index";
import {
  isAppsInTossProductionRuntime,
  isAppsInTossRuntimeSupported,
  isAppsInTossSandbox,
  safeGetAppsInTossAppVersion,
  safeGetAppsInTossNetworkStatus,
  safeGetAppsInTossOperationalEnvironment,
  safeGetAppsInTossPlatformOS,
  type AppsInTossWebRuntimeSdk,
} from "../src/runtime";

const forbidden = () => { throw new Error("deprecated top-level getter must not be used"); };

function runtimeSdk(overrides: Partial<AppsInTossWebRuntimeSdk> = {}) {
  const minVersionCalls: unknown[] = [];
  const sdk = {
    Environment: { environment: "sandbox", tossAppVersion: " 5.250.0 ", getNetworkStatus: async () => "WIFI" },
    Device: { os: "ios" },
    isMinVersionSupported: (minVersions: unknown) => { minVersionCalls.push(minVersions); return true; },
    getOperationalEnvironment: forbidden,
    getPlatformOS: forbidden,
    getTossAppVersion: forbidden,
    getNetworkStatus: forbidden,
    ...overrides,
  } as AppsInTossWebRuntimeSdk;
  return { minVersionCalls, loadSdk: async () => sdk };
}

describe("WebView runtime helpers", () => {
  test("read the SDK 3 Environment and Device namespaces", async () => {
    const { loadSdk, minVersionCalls } = runtimeSdk();
    expect(await safeGetAppsInTossOperationalEnvironment({ loadSdk })).toBe("sandbox");
    expect(await safeGetAppsInTossPlatformOS({ loadSdk })).toBe("ios");
    expect(await safeGetAppsInTossAppVersion({ loadSdk })).toBe("5.250.0");
    expect(await safeGetAppsInTossNetworkStatus({ loadSdk })).toBe("WIFI");
    expect(await isAppsInTossRuntimeSupported({ loadSdk, minAndroid: "5.247.0", minIos: "5.241.0" })).toBe(true);
    expect(minVersionCalls).toEqual([{ android: "5.247.0", ios: "5.241.0" }]);
  });

  test("a missing SDK, throwing getter or odd value is unknown, never production", async () => {
    const failingLoader = async () => { throw new Error("outside the Toss app"); };
    expect(await safeGetAppsInTossOperationalEnvironment({ loadSdk: failingLoader })).toBe("unknown");
    expect(await safeGetAppsInTossPlatformOS({ loadSdk: failingLoader })).toBe("unknown");
    expect(await safeGetAppsInTossAppVersion({ loadSdk: failingLoader })).toBeNull();
    expect(await safeGetAppsInTossNetworkStatus({ loadSdk: failingLoader })).toBe("UNKNOWN");
    expect(await isAppsInTossRuntimeSupported({ loadSdk: failingLoader })).toBe(false);

    const throwing = runtimeSdk({
      Environment: {
        get environment(): unknown { throw new Error("bridge missing"); },
        tossAppVersion: "   ",
        getNetworkStatus: () => new Promise(() => {}),
      },
      Device: { os: "windows" },
      isMinVersionSupported: (() => "yes") as unknown as AppsInTossWebRuntimeSdk["isMinVersionSupported"],
    });
    const environment = await safeGetAppsInTossOperationalEnvironment({ loadSdk: throwing.loadSdk });
    expect(environment).toBe("unknown");
    expect(isAppsInTossProductionRuntime(environment)).toBe(false);
    expect(await safeGetAppsInTossPlatformOS({ loadSdk: throwing.loadSdk })).toBe("unknown");
    expect(await safeGetAppsInTossAppVersion({ loadSdk: throwing.loadSdk })).toBeNull();
    expect(await safeGetAppsInTossNetworkStatus({ loadSdk: throwing.loadSdk, timeoutMs: 5 })).toBe("UNKNOWN");
    expect(await isAppsInTossRuntimeSupported({ loadSdk: throwing.loadSdk })).toBe(false);
  });

  test("injected readers win over the SDK loader, as on RN", async () => {
    const loadSdk = async (): Promise<AppsInTossWebRuntimeSdk> => { throw new Error("must not load"); };
    expect(await safeGetAppsInTossOperationalEnvironment({ loadSdk, getOperationalEnvironment: () => "toss" })).toBe("toss");
    expect(await safeGetAppsInTossPlatformOS({ loadSdk, getPlatformOS: () => "android" })).toBe("android");
    expect(await safeGetAppsInTossAppVersion({ loadSdk, getTossAppVersion: () => "5.251.0" })).toBe("5.251.0");
    expect(await safeGetAppsInTossNetworkStatus({ loadSdk, getNetworkStatus: async () => "5G" })).toBe("5G");
    expect(await isAppsInTossRuntimeSupported({ loadSdk, isMinVersionSupported: () => true })).toBe(true);
  });

  test("predicates are shared with RN and the ads entry re-exports the helpers", () => {
    expect(isAppsInTossSandbox).toBe(rnRuntime.isAppsInTossSandbox);
    expect(isAppsInTossProductionRuntime).toBe(rnRuntime.isAppsInTossProductionRuntime);
    expect(webAds.safeGetAppsInTossPlatformOS).toBe(safeGetAppsInTossPlatformOS);
    expect(webRoot.isAppsInTossRuntimeSupported).toBe(isAppsInTossRuntimeSupported);
    expect(webRoot.collectAppsInTossRuntimeDiagnostics).toBe(collectAppsInTossRuntimeDiagnostics);
  });
});

describe("WebView runtime diagnostics", () => {
  test("stays off unless enabled and reports only normalized values", async () => {
    let loads = 0;
    const loadSdk = async (): Promise<AppsInTossWebRuntimeSdk> => {
      loads++;
      return {
        Environment: { environment: "toss", tossAppVersion: "secret-native-message", getNetworkStatus: async () => "WIFI" },
        Device: { os: "android" },
      };
    };
    expect(await collectAppsInTossRuntimeDiagnostics({ loadSdk })).toBeNull();
    expect(loads).toBe(0);
    const report = await collectAppsInTossRuntimeDiagnostics({ enabled: true, loadSdk });
    expect(loads).toBe(1);
    expect(report).toMatchObject({
      schema: "ait-runtime-diagnostics-v1",
      environment: "toss",
      platform: "android",
      appVersion: null,
      deviceFeaturesVerified: false,
      probes: { environment: "available", platform: "available", appVersion: "unknown", network: "available" },
    });
    expect(JSON.stringify(report)).not.toContain("secret-native-message");
  });

  test("a failing loader marks every probe failed with the RN schema", async () => {
    const report = await collectAppsInTossRuntimeDiagnostics({
      enabled: true,
      loadSdk: async () => { throw new Error("secret-loader-path"); },
    });
    expect(report?.probes).toEqual({ environment: "failed", platform: "failed", appVersion: "failed", network: "failed" });
    expect(JSON.stringify(report)).not.toContain("secret");
    const probes = { environment: () => "sandbox", platform: () => "ios", appVersion: () => "5.250.0", network: () => "OFFLINE" };
    expect(await collectAppsInTossRuntimeDiagnostics({ enabled: true, probes }))
      .toEqual(await rnDiagnostics.collectAppsInTossRuntimeDiagnostics({ enabled: true, probes }));
  });
});

type FakeIap = {
  completed: string[];
  IAP: {
    getPendingOrders: () => Promise<{ orders: unknown[] }>;
    completeProductGrant: (args: { params: { orderId: string } }) => Promise<boolean>;
  };
};
function fakeIap(orders: unknown[], completeResult: (orderId: string) => boolean = () => true): FakeIap {
  const completed: string[] = [];
  return {
    completed,
    IAP: {
      getPendingOrders: async () => ({ orders }),
      completeProductGrant: async ({ params }) => { completed.push(params.orderId); return completeResult(params.orderId); },
    },
  };
}
const ordersFixture = [
  { orderId: "order-granted", sku: "coins", paymentCompletedDate: "2026-11-01T00:00:00Z" },
  { orderId: "order-pending-grant", sku: "coins", paymentCompletedDate: "2026-11-01T00:01:00Z" },
];
const codeOf = (error: unknown) => (error as InstanceType<typeof AppsInTossIapBridgeError>)?.code;
const shape = (result: AppsInTossIapRestorePendingOrdersResult) => result.results.map(entry => ({
  orderId: entry.order.orderId, granted: entry.granted, completed: entry.completed, error: codeOf(entry.error),
}));

describe("WebView IAP pending-order restore", () => {
  test("acknowledges an order only after its backend grant succeeded", async () => {
    const sdk = fakeIap(ordersFixture);
    const grants: AppsInTossIapProductGrantInput[] = [];
    const hooks: string[] = [];
    const bridge = createAppsInTossIapRestoreBridge({ loadSdk: async () => ({ IAP: sdk.IAP }) });
    const result = await bridge.restorePendingOrders({
      processProductGrant: (input) => {
        grants.push(input);
        return input.orderId === "order-granted" ? { status: "already_granted" } : { granted: false };
      },
      onProductGrantCompleted: ({ orderId }) => { hooks.push(orderId); },
    });
    expect(sdk.completed).toEqual(["order-granted"]);
    expect(hooks).toEqual(["order-granted"]);
    expect(grants.map(grant => [grant.orderId, grant.sku, grant.source])).toEqual([
      ["order-granted", "coins", "restore"],
      ["order-pending-grant", "coins", "restore"],
    ]);
    expect(result.restored.map(entry => entry.order.orderId)).toEqual(["order-granted"]);
    expect(shape(result)).toEqual([
      { orderId: "order-granted", granted: true, completed: true, error: undefined },
      { orderId: "order-pending-grant", granted: false, completed: false, error: "IAP_PRODUCT_GRANT_FAILED" },
    ]);
  });

  test("a timed-out grant or rejected acknowledgement leaves the order failed", async () => {
    const sdk = fakeIap(ordersFixture, orderId => orderId !== "order-granted");
    const bridge = createAppsInTossIapRestoreBridge({ loadSdk: async () => ({ IAP: sdk.IAP }), processProductGrantTimeoutMs: 5 });
    const result = await bridge.restorePendingOrders({
      processProductGrant: input => input.orderId === "order-granted" ? true : new Promise(() => {}),
    });
    expect(sdk.completed).toEqual(["order-granted"]);
    expect(result.restored).toEqual([]);
    expect(shape(result)).toEqual([
      { orderId: "order-granted", granted: true, completed: false, error: "IAP_COMPLETE_PRODUCT_GRANT_REJECTED" },
      { orderId: "order-pending-grant", granted: false, completed: false, error: "IAP_PRODUCT_GRANT_TIMEOUT" },
    ]);
  });

  test("matches the RN bridge for the same SDK responses", async () => {
    const scenario = async (orders: unknown[], completeAfterGrant: boolean) => {
      const web = fakeIap(orders, orderId => orderId !== "order-rejected");
      const rn = fakeIap(orders, orderId => orderId !== "order-rejected");
      const options = {
        completeAfterGrant,
        processProductGrant: (input: AppsInTossIapProductGrantInput) => input.orderId !== "order-pending-grant",
      };
      const webResult = await createAppsInTossIapRestoreBridge({ loadSdk: async () => ({ IAP: web.IAP }) }).restorePendingOrders(options);
      const rnResult = await rnIap.createAppsInTossIapBridge({ IAP: rn.IAP }).restorePendingOrders(options);
      expect(shape(webResult)).toEqual(shape(rnResult));
      expect(webResult.orders).toEqual(rnResult.orders);
      expect(web.completed).toEqual(rn.completed);
      return webResult;
    };
    const orders = [...ordersFixture, { order_id: " order-rejected ", sku: " coins " }, { orderId: "order-no-sku" }];
    const completed = await scenario(orders, true);
    expect(completed.orders[2]).toEqual({ orderId: "order-rejected", sku: "coins" });
    expect(shape(completed).map(entry => entry.error)).toEqual([
      undefined, "IAP_PRODUCT_GRANT_FAILED", "IAP_COMPLETE_PRODUCT_GRANT_REJECTED", "IAP_SKU_REQUIRED",
    ]);
    const deferred = await scenario(orders, false);
    expect(deferred.results[0]).toMatchObject({ granted: true, completed: false, completionDeferred: true });
  });

  test("reports SDK availability with the RN error codes and no loader details", async () => {
    const grant = () => true;
    const missing = await createAppsInTossIapRestoreBridge({ loadSdk: async () => { throw new Error("secret-loader-path"); } })
      .restorePendingOrders({ processProductGrant: grant }).then(() => null, error => error);
    expect(missing).toBeInstanceOf(rnIap.AppsInTossIapBridgeError);
    expect(missing.code).toBe("IAP_SDK_UNAVAILABLE");
    expect(missing.cause).toBeUndefined();
    expect(String(missing.message)).not.toContain("secret");

    const noListing = await createAppsInTossIapRestoreBridge({ loadSdk: async () => ({ IAP: {} }) })
      .getPendingOrders().then(() => null, error => error);
    expect(noListing.code).toBe("IAP_GET_PENDING_ORDERS_UNAVAILABLE");

    const oldApp = Object.assign(async () => ({ orders: [] }), { isSupported: () => false });
    const unsupported = await createAppsInTossIapRestoreBridge({ loadSdk: async () => ({ IAP: { getPendingOrders: oldApp } }) })
      .getPendingOrders().then(() => null, error => error);
    expect(unsupported.code).toBe("IAP_GET_PENDING_ORDERS_UNSUPPORTED");

    let listed = false;
    const noGrant = await createAppsInTossIapRestoreBridge({
      loadSdk: async () => ({ IAP: { getPendingOrders: async () => { listed = true; return { orders: [] }; } } }),
    }).restorePendingOrders({} as never).then(() => null, error => error);
    expect(noGrant.code).toBe("IAP_PRODUCT_GRANT_REQUIRED");
    expect(listed).toBe(false);

    const badOrderId = await createAppsInTossIapRestoreBridge({ loadSdk: async () => ({ IAP: fakeIap([]).IAP }) })
      .completeProductGrant({ orderId: "  " }).then(() => null, error => error);
    expect(badOrderId.code).toBe("IAP_ORDER_ID_REQUIRED");
  });
});
