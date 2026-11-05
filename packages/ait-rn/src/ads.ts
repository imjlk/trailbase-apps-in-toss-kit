import { createReactNativeAds } from "@ait-kit/sdk/rn";
import { defaultFrameworkFunction } from "./internal/framework";
import { createFullScreenAdBridge, type CreateAppsInTossFullScreenAdBridgeOptions } from "@trailbase-apps-in-toss-kit/ait-core/ads";
export * from "@trailbase-apps-in-toss-kit/ait-core/ads";
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


export function createAppsInTossFullScreenAdBridge(options: CreateAppsInTossFullScreenAdBridgeOptions = {}) {
  return createFullScreenAdBridge(options, {
    load: (adGroupId, timeoutMs) => createReactNativeAds({ loadTimeoutMs: timeoutMs }).loadFullScreenAd(adGroupId),
    resolveShow: () => defaultFrameworkFunction("showFullScreenAd"),
  });
}

// Preserve the native SDK's public type aliases for existing RN consumers.
export type {
  AppsInTossFullScreenAdOptions, AppsInTossFullScreenAdParams,
  AppsInTossLoadFullScreenAd, AppsInTossLoadFullScreenAdEvent, AppsInTossLoadFullScreenAdParams,
  AppsInTossShowFullScreenAd, AppsInTossShowFullScreenAdEvent, AppsInTossShowFullScreenAdParams,
} from "./internal/framework";
