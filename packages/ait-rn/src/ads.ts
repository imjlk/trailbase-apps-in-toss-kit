import {
  defaultFrameworkFunction,
  type AppsInTossLoadFullScreenAd,
  type AppsInTossShowFullScreenAd,
  type AppsInTossShowFullScreenAdEvent,
} from "./internal/framework";
import {
  createCleanupOnce,
  isAppsInTossBridgeSupported,
  withBridgeTimeout,
} from "./internal/event-bridge";
import {
  type AppsInTossHeaders,
  type AppsInTossJsonFetcher,
  postAppsInTossJson,
} from "./internal/http";
import type { AppsInTossOperationalEnvironment } from "./runtime";

export {
  isAppsInTossProductionRuntime,
  isAppsInTossRuntimeSupported,
  isAppsInTossSandbox,
  safeGetAppsInTossAppVersion,
  safeGetAppsInTossOperationalEnvironment,
  safeGetAppsInTossPlatformOS,
} from "./runtime";
export type {
  AppsInTossMinVersionRequirement,
  AppsInTossOperationalEnvironment,
  AppsInTossPlatformOS,
  IsAppsInTossRuntimeSupportedOptions,
  SafeGetAppsInTossAppVersionOptions,
  SafeGetAppsInTossOperationalEnvironmentOptions,
  SafeGetAppsInTossPlatformOSOptions,
} from "./runtime";

export type {
  AppsInTossFullScreenAdOptions,
  AppsInTossFullScreenAdParams,
  AppsInTossLoadFullScreenAd,
  AppsInTossLoadFullScreenAdEvent,
  AppsInTossLoadFullScreenAdParams,
  AppsInTossShowFullScreenAd,
  AppsInTossShowFullScreenAdEvent,
  AppsInTossShowFullScreenAdParams,
} from "./internal/framework";

export type AppsInTossAdBridgeErrorCode =
  | "AD_LOAD_FAILED"
  | "AD_LOAD_TIMEOUT"
  | "AD_LOAD_UNAVAILABLE"
  | "AD_LOAD_UNSUPPORTED"
  | "AD_SHOW_FAILED"
  | "AD_SHOW_TIMEOUT"
  | "AD_SHOW_UNAVAILABLE"
  | "AD_SHOW_UNSUPPORTED";

export interface AppsInTossAdBridgeErrorOptions {
  cause?: unknown;
  code: AppsInTossAdBridgeErrorCode;
  message: string;
}

export class AppsInTossAdBridgeError extends Error {
  code: AppsInTossAdBridgeErrorCode;
  override cause?: unknown;

  constructor({ cause, code, message }: AppsInTossAdBridgeErrorOptions) {
    super(message);
    this.name = "AppsInTossAdBridgeError";
    this.code = code;
    this.cause = cause;
  }
}

export type AppsInTossAdRewardMode = "auto" | "live" | "mock";
export type AppsInTossFullScreenAdFormat = "interstitial" | "rewarded";
export type AppsInTossTestAdGroupFormat =
  | AppsInTossFullScreenAdFormat
  | "banner"
  | "nativeImage";

export const APPS_IN_TOSS_TEST_AD_GROUP_IDS = {
  banner: "ait-ad-test-banner-id",
  interstitial: "ait-ad-test-interstitial-id",
  nativeImage: "ait-ad-test-native-image-id",
  rewarded: "ait-ad-test-rewarded-id",
} as const satisfies Record<AppsInTossTestAdGroupFormat, string>;

export interface CreateAppsInTossFullScreenAdBridgeOptions {
  loadFullScreenAd?: AppsInTossLoadFullScreenAd;
  loadTimeoutMs?: number;
  rewardFallbackMs?: number;
  showFullScreenAd?: AppsInTossShowFullScreenAd;
  showTimeoutMs?: number;
}

export interface AppsInTossPreloadFullScreenAdOptions {
  adGroupId: string;
}

export interface AppsInTossShowFullScreenAdOptions {
  adFormat: AppsInTossFullScreenAdFormat;
  adGroupId: string;
  interstitialCompletionFallbackMs?: number;
}

export interface AppsInTossPreloadAndShowFullScreenAdOptions
  extends AppsInTossShowFullScreenAdOptions {
  preloadNext?: boolean;
}

export interface AppsInTossFullScreenAdShowResult {
  adFormat: AppsInTossFullScreenAdFormat;
  adGroupId: string;
  completed: boolean;
  earned: boolean;
  events: string[];
  requestedAt: number | null;
  shownAt: number | null;
  shownDurationMs?: number;
  unitAmount?: number;
  unitType?: string;
}

export interface AppsInTossFullScreenAdBridge {
  clear(adGroupId?: string): void;
  preload(options: AppsInTossPreloadFullScreenAdOptions): Promise<void>;
  preloadAndShow(
    options: AppsInTossPreloadAndShowFullScreenAdOptions,
  ): Promise<AppsInTossFullScreenAdShowResult>;
  show(
    options: AppsInTossShowFullScreenAdOptions,
  ): Promise<AppsInTossFullScreenAdShowResult>;
}

export type AppsInTossAdRewardClaimResult =
  | "earned"
  | "failed"
  | "not_earned"
  | (string & {});

export interface AppsInTossAdRewardClaimInput {
  adPlacementId: string;
  requestId?: string | null;
  result: AppsInTossAdRewardClaimResult;
  unitAmount?: number | null;
  unitType?: string | null;
}

export interface CreateAppsInTossAdRewardClientOptions<TResult = unknown> {
  baseUrl?: string;
  claimEndpoint: string;
  fetcher?: AppsInTossJsonFetcher;
  getAuthHeaders?: () => AppsInTossHeaders | Promise<AppsInTossHeaders>;
  normalizeResponse?: (value: unknown) => TResult;
}

export interface AppsInTossAdRewardClient<TResult = unknown> {
  claim(input: AppsInTossAdRewardClaimInput): Promise<TResult>;
}

interface AppsInTossPreloadedFullScreenAdState {
  clearAfterSettle: boolean;
  promise: Promise<void>;
  settled: boolean;
}

interface AppsInTossShowingFullScreenAdState {
  preloadNextScheduled: boolean;
  result: Promise<AppsInTossFullScreenAdShowResult>;
}

export function createAppsInTossFullScreenAdBridge({
  loadFullScreenAd,
  loadTimeoutMs = 15_000,
  rewardFallbackMs = 1_500,
  showFullScreenAd,
  showTimeoutMs = 60_000,
}: CreateAppsInTossFullScreenAdBridgeOptions = {}): AppsInTossFullScreenAdBridge {
  const preloadedAds = new Map<
    string,
    AppsInTossPreloadedFullScreenAdState
  >();
  const showingAds = new Map<string, AppsInTossShowingFullScreenAdState>();

  async function preload({ adGroupId }: AppsInTossPreloadFullScreenAdOptions) {
    const normalizedAdGroupId = normalizeAdGroupId(adGroupId);
    const existing = preloadedAds.get(normalizedAdGroupId);
    if (existing) {
      return existing.promise;
    }

    const state: AppsInTossPreloadedFullScreenAdState = {
      clearAfterSettle: false,
      promise: Promise.resolve(),
      settled: false,
    };
    state.promise = loadFullScreenAdAsync({
      adGroupId: normalizedAdGroupId,
      loadFullScreenAd,
      timeoutMs: loadTimeoutMs,
    }).then(
      () => {
        state.settled = true;
        if (state.clearAfterSettle) {
          preloadedAds.delete(normalizedAdGroupId);
        }
      },
      (error) => {
        state.settled = true;
        preloadedAds.delete(normalizedAdGroupId);
        throw error;
      },
    );
    preloadedAds.set(normalizedAdGroupId, state);
    return state.promise;
  }

  function clear(adGroupId?: string) {
    if (adGroupId === undefined) {
      for (const [normalizedAdGroupId, state] of preloadedAds) {
        clearPreloadState(normalizedAdGroupId, state);
      }
      return;
    }
    const normalizedAdGroupId = normalizeAdGroupId(adGroupId);
    const state = preloadedAds.get(normalizedAdGroupId);
    if (state) {
      clearPreloadState(normalizedAdGroupId, state);
    }
  }

  function clearPreloadState(
    normalizedAdGroupId: string,
    state: AppsInTossPreloadedFullScreenAdState,
  ) {
    if (state.settled) {
      preloadedAds.delete(normalizedAdGroupId);
      return;
    }
    state.clearAfterSettle = true;
  }

  function startShow(
    options: AppsInTossShowFullScreenAdOptions,
  ): AppsInTossShowingFullScreenAdState {
    const adGroupId = normalizeAdGroupId(options.adGroupId);
    const existing = showingAds.get(adGroupId);
    if (existing) {
      return existing;
    }

    const state: AppsInTossShowingFullScreenAdState = {
      preloadNextScheduled: false,
      result: showFullScreenAdAsync({
        ...options,
        adGroupId,
        rewardFallbackMs,
        showFullScreenAd,
        timeoutMs: showTimeoutMs,
      }).finally(() => {
        clear(adGroupId);
        showingAds.delete(adGroupId);
      }),
    };
    showingAds.set(adGroupId, state);
    return state;
  }

  async function show(options: AppsInTossShowFullScreenAdOptions) {
    return startShow(options).result;
  }

  return {
    clear,
    preload,
    async preloadAndShow(options) {
      const adGroupId = normalizeAdGroupId(options.adGroupId);
      await preload({ adGroupId });
      const showingAd = startShow({ ...options, adGroupId });
      const result = await showingAd.result;
      if (
        options.preloadNext === true &&
        result.events.includes("dismissed") &&
        !showingAd.preloadNextScheduled
      ) {
        showingAd.preloadNextScheduled = true;
        void preload({ adGroupId }).catch(() => undefined);
      }
      return result;
    },
    show,
  };
}

export function getAppsInTossTestAdGroupId(
  format: AppsInTossTestAdGroupFormat,
) {
  const adGroupId = APPS_IN_TOSS_TEST_AD_GROUP_IDS[format];
  if (!adGroupId) {
    throw new TypeError("Unsupported Apps in Toss test ad group format.");
  }
  return adGroupId;
}

export function createAppsInTossAdRewardClient<TResult = unknown>({
  baseUrl,
  claimEndpoint,
  fetcher,
  getAuthHeaders,
  normalizeResponse,
}: CreateAppsInTossAdRewardClientOptions<TResult>): AppsInTossAdRewardClient<TResult> {
  return {
    async claim({ adPlacementId, requestId, result, unitAmount, unitType }) {
      const normalizedRequestId = normalizeOptionalString(requestId);
      const normalizedUnitAmount = normalizeOptionalNumber(
        unitAmount,
        "unitAmount",
      );
      const normalizedUnitType = normalizeOptionalString(unitType);
      const payload = await postAppsInTossJson({
        baseUrl,
        body: {
          adPlacementId: normalizeRequiredString(
            adPlacementId,
            "Apps in Toss adPlacementId is required.",
          ),
          ...(normalizedRequestId ? { requestId: normalizedRequestId } : {}),
          result: normalizeRequiredString(
            result,
            "Apps in Toss ad reward claim result is required.",
          ),
          ...(normalizedUnitAmount === undefined
            ? {}
            : { unitAmount: normalizedUnitAmount }),
          ...(normalizedUnitType ? { unitType: normalizedUnitType } : {}),
        },
        fetcher,
        getAuthHeaders,
        path: claimEndpoint,
      });
      return normalizeResponse
        ? normalizeResponse(payload)
        : (payload as TResult);
    },
  };
}

export function shouldUseAppsInTossMockAd({
  isDev,
  operationalEnvironment = "unknown",
  rewardMode,
}: {
  isDev: boolean;
  operationalEnvironment?: AppsInTossOperationalEnvironment;
  rewardMode: AppsInTossAdRewardMode;
}) {
  if (rewardMode === "live") {
    return false;
  }
  if (rewardMode === "mock") {
    return true;
  }
  if (operationalEnvironment === "sandbox") {
    return true;
  }
  if (operationalEnvironment === "toss") {
    return false;
  }
  return isDev;
}

async function loadFullScreenAdAsync({
  adGroupId,
  loadFullScreenAd,
  timeoutMs,
}: {
  adGroupId: string;
  loadFullScreenAd?: AppsInTossLoadFullScreenAd;
  timeoutMs: number;
}) {
  const resolvedLoadFullScreenAd =
    loadFullScreenAd ?? (await defaultFrameworkFunction("loadFullScreenAd"));
  if (!resolvedLoadFullScreenAd) {
    throw new AppsInTossAdBridgeError({
      code: "AD_LOAD_UNAVAILABLE",
      message: "Apps in Toss loadFullScreenAd is not available.",
    });
  }
  assertAdSupported(resolvedLoadFullScreenAd, {
    code: "AD_LOAD_UNSUPPORTED",
    message: "Apps in Toss full-screen ad loading is not supported.",
  });

  return new Promise<void>((resolve, reject) => {
    let settled = false;
    let cleanup = createCleanupOnce();
    const clearLoadTimeout = withBridgeTimeout({
      timeoutMs,
      onTimeout: () => {
        settleReject(
          new AppsInTossAdBridgeError({
            code: "AD_LOAD_TIMEOUT",
            message: "Apps in Toss full-screen ad load timed out.",
          }),
        );
      },
    });

    try {
      const nextCleanup = resolvedLoadFullScreenAd({
        onError: (error) =>
          settleReject(
            new AppsInTossAdBridgeError({
              cause: error,
              code: "AD_LOAD_FAILED",
              message: "Apps in Toss full-screen ad load failed.",
            }),
          ),
        onEvent: (event) => {
          if (event.type === "loaded") {
            settleResolve();
          }
        },
        options: { adGroupId },
      });
      cleanup = createCleanupOnce(nextCleanup);
      if (settled) {
        cleanup();
      }
    } catch (error) {
      settleReject(
        new AppsInTossAdBridgeError({
          cause: error,
          code: "AD_LOAD_FAILED",
          message: "Apps in Toss full-screen ad load failed.",
        }),
      );
    }

    function settleResolve() {
      if (settled) {
        return;
      }
      settled = true;
      clearLoadTimeout();
      cleanup();
      resolve();
    }

    function settleReject(error: unknown) {
      if (settled) {
        return;
      }
      settled = true;
      clearLoadTimeout();
      cleanup();
      reject(error);
    }
  });
}

async function showFullScreenAdAsync({
  adFormat,
  adGroupId,
  interstitialCompletionFallbackMs = 4_500,
  rewardFallbackMs,
  showFullScreenAd,
  timeoutMs,
}: AppsInTossShowFullScreenAdOptions & {
  rewardFallbackMs: number;
  showFullScreenAd?: AppsInTossShowFullScreenAd;
  timeoutMs: number;
}) {
  const resolvedShowFullScreenAd =
    showFullScreenAd ?? (await defaultFrameworkFunction("showFullScreenAd"));
  if (!resolvedShowFullScreenAd) {
    throw new AppsInTossAdBridgeError({
      code: "AD_SHOW_UNAVAILABLE",
      message: "Apps in Toss showFullScreenAd is not available.",
    });
  }
  assertAdSupported(resolvedShowFullScreenAd, {
    code: "AD_SHOW_UNSUPPORTED",
    message: "Apps in Toss full-screen ad showing is not supported.",
  });

  return new Promise<AppsInTossFullScreenAdShowResult>((resolve, reject) => {
    let settled = false;
    let cleanup = createCleanupOnce();
    let interstitialFallbackTimeout: ReturnType<typeof setTimeout> | null =
      null;
    let rewardFallbackTimeout: ReturnType<typeof setTimeout> | null = null;
    let requestedAt: number | null = null;
    let shownAt: number | null = null;
    let unitAmount: number | undefined;
    let unitType: string | undefined;
    const events: string[] = [];
    const clearShowTimeout = withBridgeTimeout({
      timeoutMs,
      onTimeout: () => {
        settleReject(
          new AppsInTossAdBridgeError({
            code: "AD_SHOW_TIMEOUT",
            message: "Apps in Toss full-screen ad show timed out.",
          }),
        );
      },
    });

    try {
      const nextCleanup = resolvedShowFullScreenAd({
        onError: (error) =>
          settleReject(
            new AppsInTossAdBridgeError({
              cause: error,
              code: "AD_SHOW_FAILED",
              message: "Apps in Toss full-screen ad show failed.",
            }),
          ),
        onEvent: (event) => {
          if (settled) {
            return;
          }
          const type = normalizeAdEventType(event);
          events.push(type);
          if (type === "requested") {
            requestedAt = Date.now();
            return;
          }
          if (type === "show") {
            shownAt = Date.now();
            return;
          }
          if (type === "userEarnedReward") {
            const reward = rewardDataFromEvent(event);
            unitAmount = reward.unitAmount;
            unitType = reward.unitType;
            rewardFallbackTimeout = setTimeout(() => {
              settleResolve();
            }, rewardFallbackMs);
            return;
          }
          if (type === "failedToShow") {
            settleReject(
              new AppsInTossAdBridgeError({
                code: "AD_SHOW_FAILED",
                message: "Apps in Toss full-screen ad failed to show.",
              }),
            );
            return;
          }
          if (
            type === "impression" &&
            adFormat === "interstitial" &&
            events.includes("clicked")
          ) {
            settleResolve();
            return;
          }
          if (type === "impression" && adFormat === "interstitial") {
            scheduleInterstitialFallback();
            return;
          }
          if (
            type === "clicked" &&
            adFormat === "interstitial" &&
            events.includes("impression")
          ) {
            settleResolve();
            return;
          }
          if (type === "dismissed") {
            settleResolve();
          }
        },
        options: { adGroupId },
      });
      cleanup = createCleanupOnce(nextCleanup);
      if (settled) {
        cleanup();
      }
    } catch (error) {
      settleReject(
        new AppsInTossAdBridgeError({
          cause: error,
          code: "AD_SHOW_FAILED",
          message: "Apps in Toss full-screen ad show failed.",
        }),
      );
    }

    function settleResolve() {
      if (settled) {
        return;
      }
      const shownDurationMs = calculateShownDurationMs(shownAt, requestedAt);
      const earned = events.includes("userEarnedReward");
      const completed =
        adFormat === "rewarded"
          ? earned
          : interstitialAdCompleted({
              events,
              shownDurationMs,
              thresholdMs: interstitialCompletionFallbackMs,
            });
      settled = true;
      clearShowTimeout();
      if (interstitialFallbackTimeout != null) {
        clearTimeout(interstitialFallbackTimeout);
      }
      if (rewardFallbackTimeout != null) {
        clearTimeout(rewardFallbackTimeout);
      }
      cleanup();
      resolve({
        adFormat,
        adGroupId,
        completed,
        earned,
        events,
        requestedAt,
        shownAt,
        shownDurationMs,
        unitAmount,
        unitType,
      });
    }

    function settleReject(error: unknown) {
      if (settled) {
        return;
      }
      settled = true;
      clearShowTimeout();
      if (interstitialFallbackTimeout != null) {
        clearTimeout(interstitialFallbackTimeout);
      }
      if (rewardFallbackTimeout != null) {
        clearTimeout(rewardFallbackTimeout);
      }
      cleanup();
      reject(error);
    }

    function scheduleInterstitialFallback() {
      if (interstitialFallbackTimeout != null) {
        return;
      }
      interstitialFallbackTimeout = setTimeout(() => {
        settleResolve();
      }, interstitialCompletionFallbackMs);
    }
  });
}

function normalizeAdGroupId(adGroupId: string) {
  return normalizeRequiredString(
    adGroupId,
    "Apps in Toss adGroupId is required.",
  );
}

function normalizeRequiredString(value: string, message: string) {
  const normalized = value.trim();
  if (!normalized) {
    throw new TypeError(message);
  }
  return normalized;
}

function normalizeOptionalString(value?: string | null) {
  const normalized = value?.trim();
  return normalized || undefined;
}

function normalizeOptionalNumber(
  value: number | null | undefined,
  field: string,
) {
  if (value == null) {
    return undefined;
  }
  if (!Number.isFinite(value)) {
    throw new TypeError(`Apps in Toss ${field} must be a finite number.`);
  }
  return value;
}

function assertAdSupported(
  sdkFunction: { isSupported?: () => boolean },
  error: { code: AppsInTossAdBridgeErrorCode; message: string },
) {
  if (!isAppsInTossBridgeSupported(sdkFunction)) {
    throw new AppsInTossAdBridgeError(error);
  }
}

function normalizeAdEventType(event: AppsInTossShowFullScreenAdEvent) {
  return typeof event?.type === "string" ? event.type : "";
}

function rewardDataFromEvent(event: AppsInTossShowFullScreenAdEvent) {
  if (event.type !== "userEarnedReward") {
    return {};
  }
  const data = (
    event as {
      data?: {
        unitAmount?: unknown;
        unitType?: unknown;
      };
    }
  ).data;
  return {
    unitAmount: typeof data?.unitAmount === "number" ? data.unitAmount : undefined,
    unitType: typeof data?.unitType === "string" ? data.unitType : undefined,
  };
}

function calculateShownDurationMs(
  shownAt: number | null,
  requestedAt: number | null,
) {
  const startedAt = shownAt ?? requestedAt;
  if (startedAt == null) {
    return undefined;
  }
  return Math.max(0, Date.now() - startedAt);
}

function interstitialAdCompleted({
  events,
  shownDurationMs,
  thresholdMs,
}: {
  events: string[];
  shownDurationMs?: number;
  thresholdMs: number;
}) {
  return (
    events.includes("impression") ||
    (events.includes("show") && (shownDurationMs ?? 0) >= thresholdMs)
  );
}
