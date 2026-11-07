import {
  defaultFrameworkFunction,
  type AppsInTossGetOperationalEnvironment,
  type AppsInTossInlineAd,
  type AppsInTossIsMinVersionSupported,
} from "./internal/framework";
import { isAppsInTossBridgeSupported } from "./internal/event-bridge";
import { APPS_IN_TOSS_INLINE_AD_MIN_VERSION } from "@trailbase-apps-in-toss-kit/ait-core/inline-ads";
import {
  isAppsInTossRuntimeSupported,
  safeGetAppsInTossOperationalEnvironment,
  type AppsInTossMinVersionRequirement,
  type AppsInTossOperationalEnvironment,
} from "./runtime";

// Placeholder policy and test IDs are shared with WebView through ait-core;
// only the RN InlineAd support probe stays here.
export * from "@trailbase-apps-in-toss-kit/ait-core/inline-ads";
export type { AppsInTossInlineAd } from "./internal/framework";

export interface IsAppsInTossInlineAdSupportedOptions {
  InlineAd?: AppsInTossInlineAd | null;
  getOperationalEnvironment?: AppsInTossGetOperationalEnvironment;
  isMinVersionSupported?: AppsInTossIsMinVersionSupported;
  minAndroid?: AppsInTossMinVersionRequirement;
  minIos?: AppsInTossMinVersionRequirement;
  operationalEnvironment?: AppsInTossOperationalEnvironment;
}

export async function isAppsInTossInlineAdSupported({
  getOperationalEnvironment,
  InlineAd,
  isMinVersionSupported,
  minAndroid = APPS_IN_TOSS_INLINE_AD_MIN_VERSION,
  minIos = APPS_IN_TOSS_INLINE_AD_MIN_VERSION,
  operationalEnvironment,
}: IsAppsInTossInlineAdSupportedOptions = {}) {
  const resolvedInlineAd =
    InlineAd === undefined
      ? await defaultFrameworkFunction("InlineAd")
      : InlineAd;
  if (!resolvedInlineAd) {
    return false;
  }
  if (!isAppsInTossBridgeSupported(resolvedInlineAd)) {
    return false;
  }

  const resolvedOperationalEnvironment =
    operationalEnvironment ??
    (await safeGetAppsInTossOperationalEnvironment({
      getOperationalEnvironment,
    }));
  if (resolvedOperationalEnvironment === "sandbox") {
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
