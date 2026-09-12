import { expect, test } from "bun:test";
import { createAppsInTossWebAdapter, type AppsInTossWebSdk } from "../src/index";

const available = <T extends (...args: any[]) => any>(fn: T, supported = true) => Object.assign(fn, { isSupported: () => supported });
function fixture() {
  const values = new Map<string, string>();
  const api = {
    Storage: { getItem: async (key: string) => values.get(key) ?? null,
      setItem: async (key: string, value: string) => { values.set(key, value); }, removeItem: async (key: string) => { values.delete(key); } },
    TossAuth: { login: async () => ({ authorizationCode: "one-time-code", referrer: "SANDBOX" }) },
    User: { getAnonymousKey: available(async () => ({ type: "HASH", hash: "synthetic" })) },
    Notification: { requestAgreement: available((options: any) => { options.onEvent({ type: "newAgreement" }); return () => {}; }) },
    IAP: { getPendingOrders: available(async () => ({ orders: [{ orderId: "pending", status: "UNKNOWN" }] })),
      completeProductGrant: available(async () => false), getProductItemList: available(async () => ({ products: [] })),
      getSubscriptionInfo: available(async () => ({ subscription: { status: "FUTURE_STATUS" } })) },
    Share: { createLink: async ({ path }: { path: string }) => path, sendMessage: async () => {} },
  };
  const make = (timeout = 1000) => createAppsInTossWebAdapter({ appKey: "sample", eventTimeoutMs: timeout, loadSdk: async () => api as unknown as AppsInTossWebSdk });
  return { api, values, make };
}

test("construction is lazy and SDK Storage preserves existing namespaced values", async () => {
  let loads = 0; const f = fixture(); f.values.set("sample.session", "existing-sdk-value");
  const adapter = createAppsInTossWebAdapter({ appKey: "sample", loadSdk: async () => { loads++; return f.api as unknown as AppsInTossWebSdk; } });
  expect(loads).toBe(0);
  expect(await adapter.storage.getItem("session")).toBe("existing-sdk-value");
  await adapter.storage.setItem("session", "next"); expect(f.values.get("sample.session")).toBe("next");
  await adapter.storage.removeItem("session"); expect(await adapter.storage.getItem("session")).toBeNull();
  expect(loads).toBe(1);
});

test("real sandbox login is preserved and SDK failures never fabricate identities", async () => {
  const f = fixture(); const adapter = f.make();
  expect(await adapter.login()).toEqual({ authorizationCode: "one-time-code", referrer: "SANDBOX" });
  expect(await adapter.anonymousHash()).toBe("ait:synthetic");
  f.api.User.getAnonymousKey = available(async () => ({ type: "HASH", hash: "ait:already" }));
  expect(await adapter.anonymousHash()).toBe("ait:already");
  f.api.TossAuth.login = async () => { throw new Error("PRIVATE-CANARY"); };
  try { await adapter.login(); throw new Error("expected error"); } catch (error) {
    expect((error as Error).message).toBe("Apps in Toss Web login: SDK_ERROR");
  }
  f.api.User.getAnonymousKey = available(async () => ({ type: "HASH", hash: "ait:" }));
  await expect(adapter.anonymousHash()).rejects.toMatchObject({ code: "INVALID_RESULT" });
  f.api.User.getAnonymousKey = available(async () => ({ type: "HASH", hash: "ait: padded" }));
  await expect(adapter.anonymousHash()).rejects.toMatchObject({ code: "INVALID_RESULT" });
});

test("per-method availability rejects before invoking a native feature", async () => {
  const f = fixture(); let calls = 0;
  f.api.User.getAnonymousKey = available(async () => { calls++; return { type: "HASH", hash: "unexpected" }; }, false);
  await expect(f.make().anonymousHash()).rejects.toMatchObject({ code: "UNSUPPORTED" });
  expect(calls).toBe(0);
  const missing = createAppsInTossWebAdapter({ appKey: "sample", loadSdk: async () => ({}) as AppsInTossWebSdk });
  await expect(missing.login()).rejects.toMatchObject({ code: "UNSUPPORTED" });
  const unavailable = createAppsInTossWebAdapter({ appKey: "sample", loadSdk: async () => { throw new Error("SDK absent"); } });
  await expect(unavailable.anonymousHash()).rejects.toMatchObject({ code: "UNSUPPORTED" });
});

test("notification rejection is not opt-in and synchronous duplicate events clean up once", async () => {
  const f = fixture(); let cleanups = 0;
  f.api.Notification.requestAgreement = available((options: any) => {
    expect(options.options.templateCode).toBe("reminder");
    options.onEvent({ type: "agreementRejected" }); options.onEvent({ type: "newAgreement" });
    return () => { cleanups++; };
  });
  expect(await f.make().requestNotificationAgreement("reminder")).toEqual({ result: "agreementRejected", status: "OPTED_OUT", source: "apps_in_toss_sdk", template_code: "reminder", templateCode: "reminder" });
  expect(cleanups).toBe(1);
});

test("stalled events time out and clean up; unknown notification results fail closed", async () => {
  const f = fixture(); let cleanups = 0;
  f.api.Notification.requestAgreement = available(() => () => { cleanups++; });
  await expect(f.make(5).requestNotificationAgreement("reminder")).rejects.toMatchObject({ code: "TIMEOUT" });
  expect(cleanups).toBe(1);
  f.api.Notification.requestAgreement = available((options: any) => { options.onEvent({ type: "future" }); return () => { cleanups++; }; });
  await expect(f.make().requestNotificationAgreement("reminder")).rejects.toMatchObject({ code: "INVALID_RESULT" });
  expect(cleanups).toBe(2);
});

test("purchase uses sku and the caller's server grant callback; subscriptions keep IDs", async () => {
  const f = fixture(); let cleanups = 0; const grants: unknown[] = [];
  const iap = f.api.IAP as any;
  iap.createOneTimePurchaseOrder = available((options: any) => {
    expect(options.options.sku).toBe("coins"); expect(options.options.productId).toBeUndefined();
    void Promise.resolve(options.options.processProductGrant({ orderId: "one" })).then((granted: boolean) => {
      expect(granted).toBe(true); options.onEvent({ type: "success", data: { orderId: "one" } });
    });
    return () => { cleanups++; };
  });
  iap.createSubscriptionPurchaseOrder = available((options: any) => {
    expect(options.options.sku).toBe("monthly"); expect(options.options.offerId).toBe("intro");
    void Promise.resolve(options.options.processProductGrant({ orderId: "sub", subscriptionId: "subscription" })).then(() => options.onEvent({ type: "success", data: { orderId: "sub" } }));
    return () => { cleanups++; };
  });
  const adapter = f.make(); const processProductGrant = async (input: unknown) => { grants.push(input); return true; };
  expect((await adapter.purchase({ sku: "coins", processProductGrant })).orderId).toBe("one");
  expect((await adapter.subscribe({ sku: "monthly", offerId: "intro", processProductGrant })).orderId).toBe("sub");
  expect(grants).toEqual([{ orderId: "one" }, { orderId: "sub", subscriptionId: "subscription" }]);
  expect(cleanups).toBe(2);
});

test("pending/future states and false completion acknowledgements are preserved", async () => {
  const adapter = fixture().make();
  expect(await adapter.getPendingOrders()).toEqual({ orders: [{ orderId: "pending", status: "UNKNOWN" }] });
  expect(await adapter.getSubscriptionInfo("sub")).toEqual({ subscription: { status: "FUTURE_STATUS" } });
  expect(await adapter.completeProductGrant("pending")).toBe(false);
  expect(await adapter.createShareLink("intoss://sample/invite")).toBe("intoss://sample/invite");
  await expect(adapter.createShareLink("https://example.test")).rejects.toMatchObject({ code: "INVALID_INPUT" });
});

test("failed backend grant is not replaced with a successful client fallback", async () => {
  const f = fixture(); let grants = 0; let cleanups = 0;
  (f.api.IAP as any).createOneTimePurchaseOrder = available((options: any) => {
    void Promise.resolve(options.options.processProductGrant({ orderId: "unverified" })).then((result: boolean) => {
      expect(result).toBe(false); options.onError(new Error("backend did not grant"));
    });
    return () => { cleanups++; };
  });
  await expect(f.make().purchase({ sku: "coins", processProductGrant: async () => { grants++; return false; } })).rejects.toMatchObject({ code: "SDK_ERROR" });
  expect(grants).toBe(1); expect(cleanups).toBe(1);
  await expect(f.make().purchase({ sku: "coins", processProductGrant: async () => { throw new Error("PRIVATE-CANARY"); } })).rejects.toMatchObject({ code: "SDK_ERROR" });
  expect(cleanups).toBe(2);
});

test("a void disposer does not discard later agreement events", async () => {
  const f = fixture();
  (f.api.Notification as any).requestAgreement = available((options: any) => {
    setTimeout(() => options.onEvent({ type: "alreadyAgreed" }), 1);
  });
  expect((await f.make().requestNotificationAgreement("reminder")).status).toBe("OPTED_IN");
});

test("purchase success requires a usable original order ID and preserves native metadata", async () => {
  const f = fixture();
  const setResult = (data: unknown) => {
    (f.api.IAP as any).createOneTimePurchaseOrder = available((options: any) => {
      setTimeout(() => options.onEvent({ type: "success", data }), 1);
      // An absent SDK disposer is tolerated for the purchase bridge too.
    });
  };
  for (const value of [undefined, {}, { orderId: "" }, { orderId: 4 }, { orderId: " padded " }]) {
    setResult(value);
    await expect(f.make().purchase({ sku: "coins", processProductGrant: async () => true })).rejects.toMatchObject({ code: "INVALID_RESULT" });
  }
  setResult({ order_id: "original", displayName: "Coins", amount: 100 });
  expect(await f.make().purchase({ sku: "coins", processProductGrant: async () => true })).toMatchObject({ orderId: "original", amount: 100 });
});

test("future string login referrers reach the backend unchanged", async () => {
  const f = fixture(); f.api.TossAuth.login = async () => ({ authorizationCode: "real-code", referrer: "FUTURE_FLOW" });
  expect(await f.make().login()).toEqual({ authorizationCode: "real-code", referrer: "FUTURE_FLOW" });
});
