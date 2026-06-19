import {
  defaultFrameworkFunction,
  type AppsInTossInlineAd,
  type AppsInTossIsMinVersionSupported,
} from "./internal/framework";
import { isAppsInTossBridgeSupported } from "./internal/event-bridge";
import { getAppsInTossTestAdGroupId } from "./ads";
import {
  isAppsInTossRuntimeSupported,
  type AppsInTossMinVersionRequirement,
} from "./runtime";

export type { AppsInTossInlineAd } from "./internal/framework";

export const APPS_IN_TOSS_INLINE_AD_MIN_VERSION = "5.241.0";
export const APPS_IN_TOSS_INLINE_AD_FIXED_HEIGHT = 96;

export type AppsInTossInlineAdFormat = "banner" | "nativeImage";

export interface IsAppsInTossInlineAdSupportedOptions {
  InlineAd?: AppsInTossInlineAd | null;
  isMinVersionSupported?: AppsInTossIsMinVersionSupported;
  minAndroid?: AppsInTossMinVersionRequirement;
  minIos?: AppsInTossMinVersionRequirement;
}

export type AppsInTossInlineAdRenderState =
  | "failed"
  | "idle"
  | "loading"
  | "noFill"
  | "rendered"
  | "unsupported";

export type AppsInTossInlineAdPlaceholderReason =
  | "disabled"
  | "failed"
  | "loading"
  | "none"
  | "unsupported";

export interface AppsInTossInlineAdPlaceholderOptions {
  height?: number;
  renderState?: AppsInTossInlineAdRenderState;
  reserveSpace?: boolean;
  supported: boolean;
}

export interface AppsInTossInlineAdPlaceholderDecision {
  height?: number;
  reason: AppsInTossInlineAdPlaceholderReason;
  shouldRenderPlaceholder: boolean;
}

export async function isAppsInTossInlineAdSupported({
  InlineAd,
  isMinVersionSupported,
  minAndroid = APPS_IN_TOSS_INLINE_AD_MIN_VERSION,
  minIos = APPS_IN_TOSS_INLINE_AD_MIN_VERSION,
}: IsAppsInTossInlineAdSupportedOptions = {}) {
  const resolvedInlineAd =
    InlineAd ?? (await defaultFrameworkFunction("InlineAd"));
  if (!resolvedInlineAd) {
    return false;
  }
  if (!isAppsInTossBridgeSupported(resolvedInlineAd)) {
    return false;
  }

  const resolvedIsMinVersionSupported =
    isMinVersionSupported ??
    (await defaultFrameworkFunction("isMinVersionSupported"));
  if (!resolvedIsMinVersionSupported) {
    return true;
  }

  return isAppsInTossRuntimeSupported({
    isMinVersionSupported: resolvedIsMinVersionSupported,
    minAndroid,
    minIos,
  });
}

export function getAppsInTossInlineAdTestAdGroupId(
  format: AppsInTossInlineAdFormat,
) {
  return getAppsInTossTestAdGroupId(format);
}

export function decideAppsInTossInlineAdPlaceholder({
  height = APPS_IN_TOSS_INLINE_AD_FIXED_HEIGHT,
  renderState = "idle",
  reserveSpace = true,
  supported,
}: AppsInTossInlineAdPlaceholderOptions): AppsInTossInlineAdPlaceholderDecision {
  if (!reserveSpace) {
    return {
      reason: "disabled",
      shouldRenderPlaceholder: false,
    };
  }
  if (!supported || renderState === "unsupported") {
    return placeholderDecision("unsupported", height);
  }
  if (renderState === "failed") {
    return placeholderDecision("failed", height);
  }
  if (renderState === "idle" || renderState === "loading") {
    return placeholderDecision("loading", height);
  }
  return {
    reason: "none",
    shouldRenderPlaceholder: false,
  };
}

function placeholderDecision(
  reason: Exclude<
    AppsInTossInlineAdPlaceholderReason,
    "disabled" | "none"
  >,
  height: number,
): AppsInTossInlineAdPlaceholderDecision {
  return {
    height: normalizePlaceholderHeight(height),
    reason,
    shouldRenderPlaceholder: true,
  };
}

function normalizePlaceholderHeight(height: number) {
  if (!Number.isFinite(height) || height <= 0) {
    return APPS_IN_TOSS_INLINE_AD_FIXED_HEIGHT;
  }
  return height;
}
