import { expect, test } from "bun:test";
import { createAppsInTossFullScreenAdBridge, type AppsInTossShowFullScreenAdEvent } from "../src/ads";

// Timers are shortened; the invariant is completion after the opening deadline.
test("WebView SDK 3 stays pending through long viewing and cleans up once on reward/return", async () => {
  let emit: (event: AppsInTossShowFullScreenAdEvent) => void = () => {};
  let cleanup = 0;
  let sdkLoads = 0;
  const bridge = createAppsInTossFullScreenAdBridge({
    showTimeoutMs: 10, showCompletionTimeoutMs: 500, rewardFallbackMs: 100,
    loadSdk: async () => {
      sdkLoads++;
      return {
        loadFullScreenAd: Object.assign(({ onEvent }) => { onEvent({ type: "loaded" }); return () => {}; }, { isSupported: () => true }),
        showFullScreenAd: Object.assign(({ onEvent }) => { emit = onEvent; onEvent({ type: "show" }); return () => { cleanup++; }; }, { isSupported: () => true }),
      };
    },
  });
  expect(sdkLoads).toBe(0);
  let settled = false;
  const result = bridge.show({ adGroupId: "fixture", adFormat: "rewarded" }).then(value => { settled = true; return value; });
  await Bun.sleep(35);
  expect(settled).toBe(false);
  emit({ type: "impression" });
  emit({ type: "userEarnedReward", data: { unitAmount: 1, unitType: "chance" } });
  emit({ type: "dismissed" });
  expect(await result).toMatchObject({ earned: true, events: ["show", "impression", "userEarnedReward", "dismissed"] });
  emit({ type: "dismissed" });
  expect(cleanup).toBe(1);
});

test("WebView loader errors and load timeouts reject without native fallbacks", async () => {
  const failed = createAppsInTossFullScreenAdBridge({ loadSdk: async () => { throw new Error("fixture-private"); } });
  await expect(failed.preload({ adGroupId: "fixture" })).rejects.toMatchObject({ code: "AD_LOAD_UNAVAILABLE" });
  await expect(failed.show({ adGroupId: "fixture", adFormat: "rewarded" })).rejects.toMatchObject({ code: "AD_SHOW_UNAVAILABLE" });
  const stalled = createAppsInTossFullScreenAdBridge({ loadTimeoutMs: 10, loadSdk: () => new Promise(() => {}) });
  await expect(stalled.preload({ adGroupId: "fixture" })).rejects.toMatchObject({ code: "AD_LOAD_TIMEOUT" });
});
