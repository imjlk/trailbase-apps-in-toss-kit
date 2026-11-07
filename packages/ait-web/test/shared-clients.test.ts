import { describe, expect, test } from "bun:test";
import * as rnIap from "../../ait-rn/src/iap";
import * as rnNotifications from "../../ait-rn/src/notifications";
import * as rnShare from "../../ait-rn/src/share";
import { APPS_IN_TOSS_INLINE_AD_FIXED_HEIGHT, decideAppsInTossInlineAdPlaceholder, getAppsInTossInlineAdTestAdGroupId } from "../src/ads";
import { AppsInTossIapBridgeError, createAppsInTossIapGrantClient } from "../src/iap";
import { AppsInTossNotificationAgreementError, createAppsInTossFunctionalMessageClient } from "../src/notifications";
import { createAppsInTossPromotionCampaignClient } from "../src/promotion";
import { createAppsInTossShareBridge, resolveAppsInTossDeepLink } from "../src/share";
import { createAppsInTossShoppingBridge } from "../src/shopping";
import * as webRoot from "../src/index";

type Call = { url: string; body: unknown; headers: HeadersInit | undefined };
function recordingFetcher(response: unknown) {
  const calls: Call[] = [];
  const fetcher = async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)), headers: init.headers });
    return Response.json(response);
  };
  return { calls, fetcher };
}

describe("platform-neutral clients shared through ait-core", () => {
  test("RN and WebView export the same error classes and helpers", () => {
    // One class identity across runtimes keeps `instanceof` checks valid after the cutover.
    expect(AppsInTossIapBridgeError).toBe(rnIap.AppsInTossIapBridgeError);
    expect(AppsInTossNotificationAgreementError).toBe(rnNotifications.AppsInTossNotificationAgreementError);
    expect(createAppsInTossFunctionalMessageClient).toBe(rnNotifications.createAppsInTossFunctionalMessageClient);
    expect(resolveAppsInTossDeepLink).toBe(rnShare.resolveAppsInTossDeepLink);
    expect(webRoot.createAppsInTossShareBridge).toBe(createAppsInTossShareBridge);
    expect(webRoot.createAppsInTossPromotionCampaignClient).toBe(createAppsInTossPromotionCampaignClient);
  });

  test("functional message client syncs agreements to the app backend only", async () => {
    const { calls, fetcher } = recordingFetcher({ ok: true });
    const messages = createAppsInTossFunctionalMessageClient({
      baseUrl: "https://api.example.test",
      endpoints: { syncAgreement: "/api/app/v1/notification-agreements" },
      fetcher,
      getAuthHeaders: () => ({ Authorization: "Bearer session" }),
    });
    await messages.syncAgreement({ result: "agreementRejected", templateCode: " fixture-app-order-ready " });
    expect(calls).toEqual([{
      url: "https://api.example.test/api/app/v1/notification-agreements",
      body: { result: "agreementRejected", source: "apps_in_toss_sdk", status: "OPTED_OUT", template_code: "fixture-app-order-ready" },
      headers: expect.anything(),
    }]);
    const missing = await messages.requestMessage({ templateSetCode: "fixture-app-order-ready" }).then(() => null, error => error);
    expect(missing).toBeInstanceOf(AppsInTossNotificationAgreementError);
    expect(missing.code).toBe("FUNCTIONAL_MESSAGE_REQUEST_ENDPOINT_MISSING");
    expect(calls).toHaveLength(1);
  });

  test("IAP grant client validates identifiers before any request", async () => {
    const { calls, fetcher } = recordingFetcher({ granted: true });
    const grants = createAppsInTossIapGrantClient({
      endpoints: { grantEndpoint: "/iap/grant", completeEndpoint: "/iap/complete", pendingEndpoint: "/iap/pending" },
      fetcher,
    });
    // Validation throws synchronously, exactly as the RN entry always has.
    let error: unknown;
    try { void grants.grant({ orderId: " ", sku: "coins" }); } catch (thrown) { error = thrown; }
    expect(error).toBeInstanceOf(rnIap.AppsInTossIapBridgeError);
    expect((error as InstanceType<typeof AppsInTossIapBridgeError>).code).toBe("IAP_ORDER_ID_REQUIRED");
    expect(calls).toHaveLength(0);
    await grants.grant({ orderId: " order-1 ", sku: " coins ", requestId: "  " });
    expect(calls[0].body).toEqual({ orderId: "order-1", sku: "coins" });
  });

  test("promotion and shopping clients behave the same from the WebView entry", async () => {
    const { calls, fetcher } = recordingFetcher({ providerStatus: "SUCCESS", rewardAmount: 5 });
    const promotions = createAppsInTossPromotionCampaignClient({ claimEndpoint: "/api/app/v1/promotions/claim", fetcher });
    const claim = await promotions.claim({ campaignId: " daily ", eligibilityId: "day-1", requestId: "daily:day-1" });
    expect(claim).toMatchObject({ campaignId: "daily", granted: true, status: "GRANTED", rewardAmount: 5 });
    expect(calls[0].body).toMatchObject({ campaignId: "daily" });

    const opened: string[] = [];
    const shopping = createAppsInTossShoppingBridge({ openURL: async url => { opened.push(url); } });
    expect(await shopping.open("https://evil.test/toss.shopping")).toEqual({ status: "unavailable" });
    expect(await shopping.open("https://toss.shopping/t/example?k=a%2Bb")).toEqual({ status: "dispatched" });
    expect(opened).toEqual(["https://toss.shopping/t/example?k=a%2Bb"]);
  });

  test("inline placeholder policy is available beside the WebView banner adapter", () => {
    expect(decideAppsInTossInlineAdPlaceholder({ supported: true, renderState: "loading" }))
      .toEqual({ height: APPS_IN_TOSS_INLINE_AD_FIXED_HEIGHT, reason: "loading", shouldRenderPlaceholder: true });
    expect(decideAppsInTossInlineAdPlaceholder({ supported: true, renderState: "rendered" }))
      .toEqual({ reason: "none", shouldRenderPlaceholder: false });
    expect(getAppsInTossInlineAdTestAdGroupId("banner")).toBe(webRoot.getAppsInTossTestAdGroupId("banner"));
  });
});

describe("WebView share bridge", () => {
  test("builds the deep link, shares one message and tolerates a throwing scheme lookup", async () => {
    const links: Array<[string, string | undefined]> = [];
    const shared: string[] = [];
    let loads = 0;
    const bridge = createAppsInTossShareBridge({
      fetcher: async () => undefined,
      loadSdk: async () => {
        loads++;
        return {
          getTossShareLink: async (path: string, ogImageUrl?: string) => { links.push([path, ogImageUrl]); return "https://toss.im/_m/fixture"; },
          share: async ({ message }: { message: string }) => { shared.push(message); },
          getSchemeUri: () => { throw new Error("outside the Toss app"); },
        };
      },
    });
    const link = await bridge.shareLink({
      appName: "fixture-app", path: "poll/1", query: { ref: "share" },
      ogImageUrl: "http://insecure.example.test/og.png", message: " Vote now ",
    });
    expect(link).toBe("https://toss.im/_m/fixture");
    expect(links).toEqual([["intoss://fixture-app/poll/1?ref=share", undefined]]);
    expect(shared).toEqual(["Vote now\n\nhttps://toss.im/_m/fixture"]);
    expect(await bridge.safeGetSchemeUri()).toBeNull();
    expect(loads).toBeGreaterThan(0);
  });

  test("reports unavailable SDK functions without leaking loader errors", async () => {
    const bridge = createAppsInTossShareBridge({ loadSdk: async () => { throw new Error("fixture-private-loader-error"); } });
    const error = await bridge.createShareLink({ appName: "fixture-app" }).then(() => null, error => error);
    expect(error.message).toBe("Apps in Toss getTossShareLink is not available.");
    expect(await bridge.safeGetSchemeUri()).toBeNull();
  });
});
