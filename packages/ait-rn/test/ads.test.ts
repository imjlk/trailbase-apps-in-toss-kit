import { describe, expect, test } from "bun:test";
import {
  createAppsInTossFullScreenAdBridge,
  safeGetAppsInTossOperationalEnvironment,
  shouldUseAppsInTossMockAd,
  type AppsInTossLoadFullScreenAd,
  type AppsInTossLoadFullScreenAdEvent,
  type AppsInTossShowFullScreenAd,
  type AppsInTossShowFullScreenAdEvent,
} from "../src/ads";

describe("AppsInToss full-screen ad bridge", () => {
  test("dedupes preloads by adGroupId and can clear cached preload state", async () => {
    const loadCalls: Array<{
      onEvent: (event: AppsInTossLoadFullScreenAdEvent) => void;
    }> = [];
    const loadFullScreenAd = Object.assign(
      ({ onEvent }) => {
        loadCalls.push({ onEvent });
        return () => undefined;
      },
      { isSupported: () => true },
    ) as AppsInTossLoadFullScreenAd;
    const bridge = createAppsInTossFullScreenAdBridge({ loadFullScreenAd });

    const first = bridge.preload({ adGroupId: "rewarded" });
    const second = bridge.preload({ adGroupId: "rewarded" });
    expect(loadCalls).toHaveLength(1);
    loadCalls[0].onEvent({ type: "loaded" });
    await expect(Promise.all([first, second])).resolves.toEqual([
      undefined,
      undefined,
    ]);

    bridge.clear("rewarded");
    const third = bridge.preload({ adGroupId: "rewarded" });
    expect(loadCalls).toHaveLength(2);
    loadCalls[1].onEvent({ type: "loaded" });
    await expect(third).resolves.toBeUndefined();
  });

  test("keeps in-flight preloads deduped when clear is called before settle", async () => {
    const loadCalls: Array<{
      onEvent: (event: AppsInTossLoadFullScreenAdEvent) => void;
    }> = [];
    const loadFullScreenAd = Object.assign(
      ({ onEvent }) => {
        loadCalls.push({ onEvent });
        return () => undefined;
      },
      { isSupported: () => true },
    ) as AppsInTossLoadFullScreenAd;
    const bridge = createAppsInTossFullScreenAdBridge({ loadFullScreenAd });

    const first = bridge.preload({ adGroupId: "rewarded" });
    bridge.clear("rewarded");
    const second = bridge.preload({ adGroupId: "rewarded" });
    expect(loadCalls).toHaveLength(1);
    loadCalls[0].onEvent({ type: "loaded" });
    await expect(Promise.all([first, second])).resolves.toEqual([
      undefined,
      undefined,
    ]);

    const third = bridge.preload({ adGroupId: "rewarded" });
    expect(loadCalls).toHaveLength(2);
    loadCalls[1].onEvent({ type: "loaded" });
    await expect(third).resolves.toBeUndefined();
  });

  test("rejects unsupported and timed out preload attempts", async () => {
    const unsupportedLoad = Object.assign(
      () => () => undefined,
      { isSupported: () => false },
    ) as AppsInTossLoadFullScreenAd;
    const unsupportedBridge = createAppsInTossFullScreenAdBridge({
      loadFullScreenAd: unsupportedLoad,
    });

    await expect(
      unsupportedBridge.preload({ adGroupId: "rewarded" }),
    ).rejects.toMatchObject({ code: "AD_LOAD_UNSUPPORTED" });

    let cleanupCalls = 0;
    const neverLoaded = Object.assign(
      () => {
        return () => {
          cleanupCalls += 1;
        };
      },
      { isSupported: () => true },
    ) as AppsInTossLoadFullScreenAd;
    const timeoutBridge = createAppsInTossFullScreenAdBridge({
      loadFullScreenAd: neverLoaded,
      loadTimeoutMs: 1,
    });

    await expect(
      timeoutBridge.preload({ adGroupId: "rewarded" }),
    ).rejects.toMatchObject({ code: "AD_LOAD_TIMEOUT" });
    expect(cleanupCalls).toBe(1);
  });

  test("resolves rewarded ads only after userEarnedReward", async () => {
    const showCalls: Array<{
      onEvent: (event: AppsInTossShowFullScreenAdEvent) => void;
    }> = [];
    let cleanupCalls = 0;
    const showFullScreenAd = Object.assign(
      ({ onEvent }) => {
        showCalls.push({ onEvent });
        return () => {
          cleanupCalls += 1;
        };
      },
      { isSupported: () => true },
    ) as AppsInTossShowFullScreenAd;
    const bridge = createAppsInTossFullScreenAdBridge({ showFullScreenAd });

    const showPromise = bridge.show({
      adFormat: "rewarded",
      adGroupId: "rewarded",
    });
    showCalls[0].onEvent({ type: "requested" });
    showCalls[0].onEvent({
      data: { unitAmount: 3, unitType: "coin" },
      type: "userEarnedReward",
    });
    showCalls[0].onEvent({ type: "dismissed" });

    await expect(showPromise).resolves.toMatchObject({
      adFormat: "rewarded",
      completed: true,
      earned: true,
      events: ["requested", "userEarnedReward", "dismissed"],
      unitAmount: 3,
      unitType: "coin",
    });
    expect(cleanupCalls).toBe(1);
  });

  test("resolves interstitial ads after show/impression and dismissed", async () => {
    const showCalls: Array<{
      onEvent: (event: AppsInTossShowFullScreenAdEvent) => void;
    }> = [];
    const showFullScreenAd = Object.assign(
      ({ onEvent }) => {
        showCalls.push({ onEvent });
        return () => undefined;
      },
      { isSupported: () => true },
    ) as AppsInTossShowFullScreenAd;
    const bridge = createAppsInTossFullScreenAdBridge({ showFullScreenAd });

    const showPromise = bridge.show({
      adFormat: "interstitial",
      adGroupId: "interstitial",
      interstitialCompletionFallbackMs: 0,
    });
    showCalls[0].onEvent({ type: "requested" });
    showCalls[0].onEvent({ type: "show" });
    showCalls[0].onEvent({ type: "impression" });
    showCalls[0].onEvent({ type: "dismissed" });

    await expect(showPromise).resolves.toMatchObject({
      adFormat: "interstitial",
      completed: true,
      earned: false,
      events: ["requested", "show", "impression", "dismissed"],
    });
  });

  test("resolves interstitial ads when the user clicks after impression", async () => {
    const showCalls: Array<{
      onEvent: (event: AppsInTossShowFullScreenAdEvent) => void;
    }> = [];
    const showFullScreenAd = Object.assign(
      ({ onEvent }) => {
        showCalls.push({ onEvent });
        return () => undefined;
      },
      { isSupported: () => true },
    ) as AppsInTossShowFullScreenAd;
    const bridge = createAppsInTossFullScreenAdBridge({ showFullScreenAd });

    const showPromise = bridge.show({
      adFormat: "interstitial",
      adGroupId: "interstitial",
    });
    showCalls[0].onEvent({ type: "requested" });
    showCalls[0].onEvent({ type: "show" });
    showCalls[0].onEvent({ type: "impression" });
    showCalls[0].onEvent({ type: "clicked" });

    await expect(showPromise).resolves.toMatchObject({
      adFormat: "interstitial",
      completed: true,
      events: ["requested", "show", "impression", "clicked"],
    });
  });

  test("waits for an impression when interstitial clicks arrive early", async () => {
    const showCalls: Array<{
      onEvent: (event: AppsInTossShowFullScreenAdEvent) => void;
    }> = [];
    const showFullScreenAd = Object.assign(
      ({ onEvent }) => {
        showCalls.push({ onEvent });
        return () => undefined;
      },
      { isSupported: () => true },
    ) as AppsInTossShowFullScreenAd;
    const bridge = createAppsInTossFullScreenAdBridge({ showFullScreenAd });

    const showPromise = bridge.show({
      adFormat: "interstitial",
      adGroupId: "interstitial",
    });
    const sentinel = Symbol("pending");
    showCalls[0].onEvent({ type: "clicked" });
    await expect(
      Promise.race([
        showPromise,
        new Promise((resolve) => setTimeout(() => resolve(sentinel), 0)),
      ]),
    ).resolves.toBe(sentinel);

    showCalls[0].onEvent({ type: "impression" });
    await expect(showPromise).resolves.toMatchObject({
      completed: true,
      events: ["clicked", "impression"],
    });
  });

  test("resolves interstitial ads after impression when dismissed is omitted", async () => {
    const showCalls: Array<{
      onEvent: (event: AppsInTossShowFullScreenAdEvent) => void;
    }> = [];
    const showFullScreenAd = Object.assign(
      ({ onEvent }) => {
        showCalls.push({ onEvent });
        return () => undefined;
      },
      { isSupported: () => true },
    ) as AppsInTossShowFullScreenAd;
    const bridge = createAppsInTossFullScreenAdBridge({
      showFullScreenAd,
      showTimeoutMs: 1_000,
    });

    const showPromise = bridge.show({
      adFormat: "interstitial",
      adGroupId: "interstitial",
      interstitialCompletionFallbackMs: 1,
    });
    showCalls[0].onEvent({ type: "requested" });
    showCalls[0].onEvent({ type: "show" });
    showCalls[0].onEvent({ type: "impression" });

    await expect(showPromise).resolves.toMatchObject({
      adFormat: "interstitial",
      completed: true,
      events: ["requested", "show", "impression"],
    });
  });

  test("ignores late show callbacks after an ad result has settled", async () => {
    const showCalls: Array<{
      onEvent: (event: AppsInTossShowFullScreenAdEvent) => void;
    }> = [];
    const showFullScreenAd = Object.assign(
      ({ onEvent }) => {
        showCalls.push({ onEvent });
        return () => undefined;
      },
      { isSupported: () => true },
    ) as AppsInTossShowFullScreenAd;
    const bridge = createAppsInTossFullScreenAdBridge({
      showFullScreenAd,
      showTimeoutMs: 1_000,
    });

    const showPromise = bridge.show({
      adFormat: "interstitial",
      adGroupId: "interstitial",
      interstitialCompletionFallbackMs: 1,
    });
    showCalls[0].onEvent({ type: "requested" });
    showCalls[0].onEvent({ type: "show" });
    showCalls[0].onEvent({ type: "impression" });
    const result = await showPromise;

    showCalls[0].onEvent({ type: "dismissed" });
    showCalls[0].onEvent({ type: "clicked" });
    expect(result.events).toEqual(["requested", "show", "impression"]);
  });

  test("cleans up when SDK callbacks settle synchronously", async () => {
    let loadCleanupCalls = 0;
    let showCleanupCalls = 0;
    const loadFullScreenAd = Object.assign(
      ({ onEvent }) => {
        onEvent({ type: "loaded" });
        return () => {
          loadCleanupCalls += 1;
        };
      },
      { isSupported: () => true },
    ) as AppsInTossLoadFullScreenAd;
    const showFullScreenAd = Object.assign(
      ({ onEvent }) => {
        onEvent({ type: "userEarnedReward" });
        onEvent({ type: "dismissed" });
        return () => {
          showCleanupCalls += 1;
        };
      },
      { isSupported: () => true },
    ) as AppsInTossShowFullScreenAd;
    const bridge = createAppsInTossFullScreenAdBridge({
      loadFullScreenAd,
      showFullScreenAd,
    });

    await expect(bridge.preload({ adGroupId: "rewarded" })).resolves.toBeUndefined();
    await expect(
      bridge.show({ adFormat: "rewarded", adGroupId: "rewarded" }),
    ).resolves.toMatchObject({ earned: true });
    expect(loadCleanupCalls).toBe(1);
    expect(showCleanupCalls).toBe(1);
  });

  test("clears consumed preload state when show is called separately", async () => {
    const loadCalls: Array<{
      onEvent: (event: AppsInTossLoadFullScreenAdEvent) => void;
    }> = [];
    const showCalls: Array<{
      onEvent: (event: AppsInTossShowFullScreenAdEvent) => void;
    }> = [];
    const loadFullScreenAd = Object.assign(
      ({ onEvent }) => {
        loadCalls.push({ onEvent });
        return () => undefined;
      },
      { isSupported: () => true },
    ) as AppsInTossLoadFullScreenAd;
    const showFullScreenAd = Object.assign(
      ({ onEvent }) => {
        showCalls.push({ onEvent });
        return () => undefined;
      },
      { isSupported: () => true },
    ) as AppsInTossShowFullScreenAd;
    const bridge = createAppsInTossFullScreenAdBridge({
      loadFullScreenAd,
      showFullScreenAd,
    });

    const preloadPromise = bridge.preload({ adGroupId: "interstitial" });
    loadCalls[0].onEvent({ type: "loaded" });
    await expect(preloadPromise).resolves.toBeUndefined();

    const showPromise = bridge.show({
      adFormat: "interstitial",
      adGroupId: "interstitial",
    });
    showCalls[0].onEvent({ type: "show" });
    showCalls[0].onEvent({ type: "impression" });
    showCalls[0].onEvent({ type: "dismissed" });
    await expect(showPromise).resolves.toMatchObject({ completed: true });

    const nextPreloadPromise = bridge.preload({ adGroupId: "interstitial" });
    expect(loadCalls).toHaveLength(2);
    loadCalls[1].onEvent({ type: "loaded" });
    await expect(nextPreloadPromise).resolves.toBeUndefined();
  });

  test("rejects failedToShow and show timeouts while cleaning up once", async () => {
    const showCalls: Array<{
      onEvent: (event: AppsInTossShowFullScreenAdEvent) => void;
    }> = [];
    let cleanupCalls = 0;
    const showFullScreenAd = Object.assign(
      ({ onEvent }) => {
        showCalls.push({ onEvent });
        return () => {
          cleanupCalls += 1;
        };
      },
      { isSupported: () => true },
    ) as AppsInTossShowFullScreenAd;
    const bridge = createAppsInTossFullScreenAdBridge({ showFullScreenAd });

    const failedShow = bridge.show({
      adFormat: "rewarded",
      adGroupId: "rewarded",
    });
    showCalls[0].onEvent({ type: "failedToShow" });
    await expect(failedShow).rejects.toMatchObject({
      code: "AD_SHOW_FAILED",
    });
    expect(cleanupCalls).toBe(1);

    const timeoutBridge = createAppsInTossFullScreenAdBridge({
      showFullScreenAd,
      showTimeoutMs: 1,
    });
    await expect(
      timeoutBridge.show({ adFormat: "rewarded", adGroupId: "rewarded" }),
    ).rejects.toMatchObject({ code: "AD_SHOW_TIMEOUT" });
    expect(cleanupCalls).toBe(2);
  });

  test("preloadAndShow enforces load-show order and can schedule the next preload", async () => {
    const loadCalls: Array<{
      onEvent: (event: AppsInTossLoadFullScreenAdEvent) => void;
    }> = [];
    const showCalls: Array<{
      onEvent: (event: AppsInTossShowFullScreenAdEvent) => void;
    }> = [];
    const loadFullScreenAd = Object.assign(
      ({ onEvent }) => {
        loadCalls.push({ onEvent });
        return () => undefined;
      },
      { isSupported: () => true },
    ) as AppsInTossLoadFullScreenAd;
    const showFullScreenAd = Object.assign(
      ({ onEvent }) => {
        showCalls.push({ onEvent });
        return () => undefined;
      },
      { isSupported: () => true },
    ) as AppsInTossShowFullScreenAd;
    const bridge = createAppsInTossFullScreenAdBridge({
      loadFullScreenAd,
      showFullScreenAd,
    });

    const showPromise = bridge.preloadAndShow({
      adFormat: "rewarded",
      adGroupId: "rewarded",
      preloadNext: true,
    });
    expect(loadCalls).toHaveLength(1);
    expect(showCalls).toHaveLength(0);
    loadCalls[0].onEvent({ type: "loaded" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(showCalls).toHaveLength(1);
    showCalls[0].onEvent({ type: "userEarnedReward" });
    showCalls[0].onEvent({ type: "dismissed" });
    await expect(showPromise).resolves.toMatchObject({ earned: true });
    expect(loadCalls).toHaveLength(2);
  });

  test("shares overlapping preloadAndShow calls for the same adGroupId", async () => {
    const loadCalls: Array<{
      onEvent: (event: AppsInTossLoadFullScreenAdEvent) => void;
    }> = [];
    const showCalls: Array<{
      onEvent: (event: AppsInTossShowFullScreenAdEvent) => void;
    }> = [];
    const loadFullScreenAd = Object.assign(
      ({ onEvent }) => {
        loadCalls.push({ onEvent });
        return () => undefined;
      },
      { isSupported: () => true },
    ) as AppsInTossLoadFullScreenAd;
    const showFullScreenAd = Object.assign(
      ({ onEvent }) => {
        showCalls.push({ onEvent });
        return () => undefined;
      },
      { isSupported: () => true },
    ) as AppsInTossShowFullScreenAd;
    const bridge = createAppsInTossFullScreenAdBridge({
      loadFullScreenAd,
      showFullScreenAd,
    });

    const firstShow = bridge.preloadAndShow({
      adFormat: "rewarded",
      adGroupId: "rewarded",
      preloadNext: true,
    });
    const secondShow = bridge.preloadAndShow({
      adFormat: "rewarded",
      adGroupId: "rewarded",
      preloadNext: true,
    });

    expect(loadCalls).toHaveLength(1);
    loadCalls[0].onEvent({ type: "loaded" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(showCalls).toHaveLength(1);

    showCalls[0].onEvent({ type: "userEarnedReward" });
    showCalls[0].onEvent({ type: "dismissed" });
    await expect(Promise.all([firstShow, secondShow])).resolves.toEqual([
      expect.objectContaining({ earned: true }),
      expect.objectContaining({ earned: true }),
    ]);
    expect(loadCalls).toHaveLength(2);
  });

  test("does not preload the next ad when show settles before dismissal", async () => {
    const loadCalls: Array<{
      onEvent: (event: AppsInTossLoadFullScreenAdEvent) => void;
    }> = [];
    const showCalls: Array<{
      onEvent: (event: AppsInTossShowFullScreenAdEvent) => void;
    }> = [];
    const loadFullScreenAd = Object.assign(
      ({ onEvent }) => {
        loadCalls.push({ onEvent });
        return () => undefined;
      },
      { isSupported: () => true },
    ) as AppsInTossLoadFullScreenAd;
    const showFullScreenAd = Object.assign(
      ({ onEvent }) => {
        showCalls.push({ onEvent });
        return () => undefined;
      },
      { isSupported: () => true },
    ) as AppsInTossShowFullScreenAd;
    const bridge = createAppsInTossFullScreenAdBridge({
      loadFullScreenAd,
      showFullScreenAd,
      showTimeoutMs: 1_000,
    });

    const showPromise = bridge.preloadAndShow({
      adFormat: "interstitial",
      adGroupId: "interstitial",
      interstitialCompletionFallbackMs: 1,
      preloadNext: true,
    });
    loadCalls[0].onEvent({ type: "loaded" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    showCalls[0].onEvent({ type: "show" });
    showCalls[0].onEvent({ type: "impression" });

    await expect(showPromise).resolves.toMatchObject({
      completed: true,
      events: ["show", "impression"],
    });
    expect(loadCalls).toHaveLength(1);
  });

  test("exposes mock mode and safe environment helpers", async () => {
    expect(
      shouldUseAppsInTossMockAd({
        isDev: false,
        operationalEnvironment: "toss",
        rewardMode: "live",
      }),
    ).toBe(false);
    expect(
      shouldUseAppsInTossMockAd({
        isDev: false,
        operationalEnvironment: "toss",
        rewardMode: "mock",
      }),
    ).toBe(true);
    expect(
      shouldUseAppsInTossMockAd({
        isDev: true,
        operationalEnvironment: "unknown",
        rewardMode: "auto",
      }),
    ).toBe(true);
    expect(
      shouldUseAppsInTossMockAd({
        isDev: false,
        operationalEnvironment: "sandbox",
        rewardMode: "auto",
      }),
    ).toBe(true);
    expect(
      shouldUseAppsInTossMockAd({
        isDev: true,
        operationalEnvironment: "sandbox",
        rewardMode: "auto",
      }),
    ).toBe(true);
    expect(
      shouldUseAppsInTossMockAd({
        isDev: true,
        operationalEnvironment: "sandbox",
        rewardMode: "live",
      }),
    ).toBe(false);
    expect(
      shouldUseAppsInTossMockAd({
        isDev: true,
        operationalEnvironment: "toss",
        rewardMode: "auto",
      }),
    ).toBe(false);

    await expect(
      safeGetAppsInTossOperationalEnvironment({
        getOperationalEnvironment: () => "sandbox",
      }),
    ).resolves.toBe("sandbox");
    await expect(
      safeGetAppsInTossOperationalEnvironment({
        getOperationalEnvironment: () => {
          throw new Error("runtime unavailable");
        },
      }),
    ).resolves.toBe("unknown");
  });
});
