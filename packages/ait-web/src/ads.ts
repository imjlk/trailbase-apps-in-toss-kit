import { createWebViewAds } from "@ait-kit/sdk/web";
import { createFullScreenAdBridge, type CreateAppsInTossFullScreenAdBridgeOptions, type AppsInTossLoadFullScreenAd, type AppsInTossShowFullScreenAd } from "@trailbase-apps-in-toss-kit/ait-core/ads";
export * from "@trailbase-apps-in-toss-kit/ait-core/ads";
// Inline/banner placeholder policy shared with RN; the slot itself is a consumer-owned DOM target.
export * from "@trailbase-apps-in-toss-kit/ait-core/inline-ads";

export interface CreateAppsInTossWebFullScreenAdBridgeOptions extends CreateAppsInTossFullScreenAdBridgeOptions {
  /** Resolve from the consumer's SDK dependency; never acquires the RN SDK. */
  loadSdk?: () => Promise<{ loadFullScreenAd: AppsInTossLoadFullScreenAd; showFullScreenAd: AppsInTossShowFullScreenAd }>;
}

/** Same event/retry/long-viewing behavior as RN, with SDK 3 acquisition only. */
export function createAppsInTossFullScreenAdBridge({ loadSdk = () => import("@apps-in-toss/web-framework"), ...options }: CreateAppsInTossWebFullScreenAdBridgeOptions = {}) {
  return createFullScreenAdBridge(options, {
    load: (adGroupId, timeoutMs) => createWebViewAds({
      loadTimeoutMs: timeoutMs,
      framework: async () => {
        try { return { available: true, module: await loadSdk() }; }
        catch { return { available: false, reason: "WebView SDK unavailable" }; }
      },
    }).loadFullScreenAd(adGroupId),
    resolveShow: async () => {
      try { return (await loadSdk()).showFullScreenAd; }
      catch { return undefined; }
    },
  });
}

// DOM banner lifetime is implemented by the shared SDK adapter, not an RN component.
export { createWebViewBannerAds, type WebViewBannerAdsOptions, type WebViewBannerHandle, type WebViewBannerOptions } from "@ait-kit/sdk/web";
