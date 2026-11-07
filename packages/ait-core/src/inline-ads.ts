import { getAppsInTossTestAdGroupId } from "./ads";

export const APPS_IN_TOSS_INLINE_AD_MIN_VERSION = "5.241.0";
export const APPS_IN_TOSS_INLINE_AD_FIXED_HEIGHT = 96;

export type AppsInTossInlineAdFormat = "banner" | "nativeImage";

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
