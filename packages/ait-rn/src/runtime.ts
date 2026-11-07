import {
  defaultFrameworkFunction,
  type AppsInTossGetOperationalEnvironment,
  type AppsInTossGetPlatformOS,
  type AppsInTossGetTossAppVersion,
  type AppsInTossIsMinVersionSupported,
} from "./internal/framework";
import {
  readAppVersion,
  readMinVersionSupported,
  readNetworkStatusWithin,
  readOperationalEnvironment,
  readPlatformOS,
} from "@trailbase-apps-in-toss-kit/ait-core/internal/runtime";
import type { AppsInTossMinVersionRequirement } from "@trailbase-apps-in-toss-kit/ait-core/runtime";

// Runtime vocabulary and predicates are shared with WebView through ait-core;
// only the RN SDK acquisition stays here.
export * from "@trailbase-apps-in-toss-kit/ait-core/runtime";

/** A missing or stalled optional native probe must not block read refreshes. */
export async function safeGetAppsInTossNetworkStatus({
  getNetworkStatus,
  timeoutMs = 3_000,
}: {
  getNetworkStatus?: () => Promise<unknown>;
  timeoutMs?: number;
} = {}): Promise<unknown> {
  return readNetworkStatusWithin(async () => {
    const read = getNetworkStatus ?? await defaultFrameworkFunction("getNetworkStatus");
    return read ? await read() : "UNKNOWN";
  }, timeoutMs);
}

export interface SafeGetAppsInTossOperationalEnvironmentOptions {
  getOperationalEnvironment?: AppsInTossGetOperationalEnvironment;
}

export interface SafeGetAppsInTossPlatformOSOptions {
  getPlatformOS?: AppsInTossGetPlatformOS;
}

export interface SafeGetAppsInTossAppVersionOptions {
  getTossAppVersion?: AppsInTossGetTossAppVersion;
}

export interface IsAppsInTossRuntimeSupportedOptions {
  isMinVersionSupported?: AppsInTossIsMinVersionSupported;
  minAndroid?: AppsInTossMinVersionRequirement;
  minIos?: AppsInTossMinVersionRequirement;
}

export async function safeGetAppsInTossOperationalEnvironment({
  getOperationalEnvironment,
}: SafeGetAppsInTossOperationalEnvironmentOptions = {}) {
  const resolved =
    getOperationalEnvironment ??
    (await defaultFrameworkFunction("getOperationalEnvironment"));
  return readOperationalEnvironment(() => resolved?.());
}

export async function safeGetAppsInTossPlatformOS({
  getPlatformOS,
}: SafeGetAppsInTossPlatformOSOptions = {}) {
  const resolved = getPlatformOS ?? (await defaultFrameworkFunction("getPlatformOS"));
  return readPlatformOS(() => resolved?.());
}

export async function safeGetAppsInTossAppVersion({
  getTossAppVersion,
}: SafeGetAppsInTossAppVersionOptions = {}) {
  const resolved =
    getTossAppVersion ?? (await defaultFrameworkFunction("getTossAppVersion"));
  return readAppVersion(() => resolved?.());
}

export async function isAppsInTossRuntimeSupported({
  isMinVersionSupported,
  minAndroid = "always",
  minIos = "always",
}: IsAppsInTossRuntimeSupportedOptions = {}) {
  const resolved =
    isMinVersionSupported ??
    (await defaultFrameworkFunction("isMinVersionSupported"));
  return readMinVersionSupported(resolved, minAndroid, minIos);
}
