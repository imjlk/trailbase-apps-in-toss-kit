import { createAppsInTossWebAdapter } from "../../src/index";

// Explicit synthetic issuer for the browser build regression. All other SDK
// namespaces come from the installed official WebView SDK; no native call runs.
export function createConsumer(scenario = "success") {
  const calls = { loads: 0, codes: 0, hashes: 0 };
  const adapter = createAppsInTossWebAdapter({
    appKey: "minified-consumer",
    loadSdk: async () => {
      calls.loads++;
      if (scenario === "load-failure") throw new Error("fixture-private-loader-error");
      // Keep User separate before spreading the remaining namespace: Bun 1.4.2
      // can lose a binding reused by outer and nested spreads after await.
      const { User, ...sdk } = await import("@apps-in-toss/web-framework");
      return {
        ...sdk,
        User: {
          ...User,
          getAnonymousKey: Object.assign(async () => { calls.hashes++; return { type: "HASH" as const, hash: "fixture-hash" }; },
            User.getAnonymousKey, { isSupported: () => true }),
          createAnonymousKeyAuthCode: Object.assign(async () => {
            calls.codes++;
            if (scenario === "issue-failure") throw new Error("fixture-private-provider-error");
            return { code: `fixture-code-${calls.codes}`, expiresIn: scenario === "invalid-result" ? 0 : 300 };
          }, { isSupported: () => scenario !== "unsupported" }),
        },
      };
    },
  });
  return { adapter, calls };
}

import {
  createAppsInTossFullScreenAdBridge, createAdSkipRedemptionController,
  createPersistentJsonAtom, createAppsInTossSdkStorageBridge,
  createAnalyticsRouter, createAppsInTossAnalyticsConfig,
  type AdSkipRedemptionReceipt, type AdSkipRedemptionRequest,
  type AppsInTossLoadFullScreenAdParams, type AppsInTossShowFullScreenAdParams,
} from "../../src/index";

/** Synthetic migration smoke executed from the emitted browser chunks. */
export async function exerciseSharedFlow() {
  const values = new Map([["fixture.saved", "[1,2,3]"]]);
  const storage = createAppsInTossSdkStorageBridge({ framework: { Storage: {
    getItem: async key => values.get(key) ?? null,
    setItem: async (key, value) => { values.set(key, value); },
    removeItem: async key => { values.delete(key); },
  } } });
  const atom = createPersistentJsonAtom({ storage, key: "fixture.saved", fallback: [] as number[] });
  const saved = await atom.read();
  const wire: AdSkipRedemptionRequest[] = [];
  let lost = true;
  let effects = 0;
  const controller = () => createAdSkipRedemptionController({
    storage, storageKey: "fixture.adSkips", maxAttempts: 1,
    createRequestId: () => "request-000000001",
    redeem: async request => {
      wire.push(request);
      if (lost) { lost = false; throw new TypeError("fixture lost response"); }
      return { ...request, context: request.context ?? "", balance: 1, consumed: 1,
        createdAt: 10, opportunity: null, receiptId: "a".repeat(48), replayed: true,
        resolution: "TICKET" } satisfies AdSkipRedemptionReceipt;
    },
  });
  const initial = await controller().redeem({ placement: "generation_continue", opportunityKey: "cycle:1", context: "generation:req-1" });
  const restarted = controller();
  const replay = await restarted.retryPending();
  const result = replay[0];
  if (result?.status !== "resolved") throw new Error("expected reconciled receipt");
  await restarted.applyEffectOnce(result.receipt, () => { effects++; });
  await controller().applyEffectOnce(result.receipt, () => { effects++; });
  let cleanups = 0;
  const ads = createAppsInTossFullScreenAdBridge({
    loadSdk: async () => ({
      loadFullScreenAd: Object.assign(({ onEvent }: AppsInTossLoadFullScreenAdParams) => { onEvent({ type: "loaded" }); return () => { cleanups++; }; }, { isSupported: () => true }),
      showFullScreenAd: Object.assign(({ onEvent }: AppsInTossShowFullScreenAdParams) => {
        onEvent({ type: "show" }); onEvent({ type: "impression" });
        onEvent({ type: "userEarnedReward", data: { unitType: "chance", unitAmount: 1 } });
        onEvent({ type: "dismissed" }); return () => { cleanups++; };
      }, { isSupported: () => true }),
    }),
  });
  const shown = await ads.preloadAndShow({ adFormat: "rewarded", adGroupId: "fixture", preloadNext: false });
  const logs: unknown[] = [];
  const router = createAnalyticsRouter({ appsInToss: createAppsInTossAnalyticsConfig({
    analyticsModule: { log: async event => { logs.push(event); } },
    mapEvent: event => ({ name: event.eventName, type: "custom", params: event.eventPayload }),
  }) });
  router.track("ad_skip_used", { experiment_id: "fixture-experiment", variant: "control", nested: { omitted: true } });
  await router.flush();
  return { saved, initial: initial.status, replayed: result.receipt.replayed, effects, wire, shown, cleanups, logs };
}

import {
  createAppsInTossShareBridge, createAppsInTossShoppingBridge,
  createAppsInTossPromotionCampaignClient, createAppsInTossFunctionalMessageClient,
  decideAppsInTossInlineAdPlaceholder,
} from "../../src/index";

/** RN-to-WebView client helpers executed from the emitted browser chunks. */
export async function exerciseClientHelpers() {
  const posted: Array<{ url: string; body: unknown }> = [];
  const fetcher = async (url: string, init: RequestInit) => {
    posted.push({ url, body: JSON.parse(String(init.body)) });
    return Response.json({ providerStatus: "SUCCESS", rewardAmount: 1 });
  };
  const shared: string[] = [];
  const share = createAppsInTossShareBridge({
    fetcher: async () => undefined,
    loadSdk: async () => ({
      getTossShareLink: async (path: string) => `https://toss.im/_m/fixture?path=${encodeURIComponent(path)}`,
      share: async ({ message }: { message: string }) => { shared.push(message); },
    }),
  });
  const link = await share.shareLink({ appName: "fixture-app", path: "/poll/1", message: "Fixture" });
  const opened: string[] = [];
  const shopping = createAppsInTossShoppingBridge({ openURL: async url => { opened.push(url); } });
  const shoppingResult = await shopping.open("https://toss.shopping/t/fixture");
  const claim = await createAppsInTossPromotionCampaignClient({ claimEndpoint: "/claim", fetcher })
    .claim({ campaignId: "fixture", eligibilityId: "day-1", requestId: "fixture:day-1" });
  await createAppsInTossFunctionalMessageClient({ endpoints: { syncAgreement: "/agreements" }, fetcher })
    .syncAgreement({ result: "newAgreement", templateCode: "fixture-app-alert" });
  const placeholder = decideAppsInTossInlineAdPlaceholder({ supported: false });
  return { link, shared, opened, shoppingResult, claim: claim.status, posted, placeholder };
}

import {
  collectAppsInTossRuntimeDiagnostics,
  createAppsInTossIapRestoreBridge,
  isAppsInTossProductionRuntime,
  safeGetAppsInTossNetworkStatus,
  safeGetAppsInTossOperationalEnvironment,
} from "../../src/index";

// Runtime probes use the real SDK loader outside the Toss app; restore uses a
// synthetic IAP namespace so no order is ever acknowledged for real.
export async function exerciseRuntimeAndRestore() {
  const environment = await safeGetAppsInTossOperationalEnvironment();
  const network = await safeGetAppsInTossNetworkStatus({ timeoutMs: 50 });
  const diagnostics = await collectAppsInTossRuntimeDiagnostics({ enabled: true, timeoutMs: 50 });
  const acknowledged: string[] = [];
  const restore = await createAppsInTossIapRestoreBridge({
    loadSdk: async () => ({
      IAP: {
        getPendingOrders: async () => ({ orders: [{ orderId: "fixture-order", sku: "fixture-sku", paymentCompletedDate: "2026-11-01" }] }),
        completeProductGrant: async ({ params }: { params: { orderId: string } }) => { acknowledged.push(params.orderId); return true; },
      },
    }),
  }).restorePendingOrders({ processProductGrant: ({ orderId }) => ({ granted: orderId === "fixture-order" }) });
  return {
    environment,
    production: isAppsInTossProductionRuntime(environment),
    network,
    diagnostics: diagnostics && { environment: diagnostics.environment, deviceFeaturesVerified: diagnostics.deviceFeaturesVerified },
    restored: restore.restored.map(entry => entry.order.orderId),
    acknowledged,
  };
}
