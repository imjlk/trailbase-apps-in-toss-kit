import {
  readAppVersion,
  readMinVersionSupported,
  readNetworkStatusWithin,
  readOperationalEnvironment,
  readPlatformOS,
} from "@trailbase-apps-in-toss-kit/ait-core/internal/runtime";
import type { AppsInTossMinVersionRequirement } from "@trailbase-apps-in-toss-kit/ait-core/runtime";
export * from "@trailbase-apps-in-toss-kit/ait-core/runtime";

/**
 * The SDK 3 members these helpers read. `Environment` and `Device` replace the
 * deprecated top-level getters; `isMinVersionSupported` stays top-level.
 */
export interface AppsInTossWebRuntimeSdk {
  Environment?: {
    readonly environment?: unknown;
    readonly tossAppVersion?: unknown;
    getNetworkStatus?: () => Promise<unknown>;
  };
  Device?: { readonly os?: unknown };
  isMinVersionSupported?: (minVersions: {
    android: AppsInTossMinVersionRequirement;
    ios: AppsInTossMinVersionRequirement;
  }) => boolean;
}

interface WebRuntimeSdkOption {
  /** Resolve from the consumer's SDK dependency; never acquires the RN SDK. */
  loadSdk?: () => Promise<AppsInTossWebRuntimeSdk>;
}

export interface SafeGetAppsInTossOperationalEnvironmentOptions extends WebRuntimeSdkOption {
  getOperationalEnvironment?: () => unknown;
}

export interface SafeGetAppsInTossPlatformOSOptions extends WebRuntimeSdkOption {
  getPlatformOS?: () => unknown;
}

export interface SafeGetAppsInTossAppVersionOptions extends WebRuntimeSdkOption {
  getTossAppVersion?: () => unknown;
}

export interface SafeGetAppsInTossNetworkStatusOptions extends WebRuntimeSdkOption {
  getNetworkStatus?: () => Promise<unknown>;
  timeoutMs?: number;
}

export interface IsAppsInTossRuntimeSupportedOptions extends WebRuntimeSdkOption {
  isMinVersionSupported?: AppsInTossWebRuntimeSdk["isMinVersionSupported"];
  minAndroid?: AppsInTossMinVersionRequirement;
  minIos?: AppsInTossMinVersionRequirement;
}

const loadWebSdk = () => import("@apps-in-toss/web-framework");

async function optionalSdk(loadSdk: () => Promise<AppsInTossWebRuntimeSdk>) {
  try {
    return await loadSdk();
  } catch {
    return undefined;
  }
}

/** Outside the Toss app, or on any SDK failure, this is "unknown", never production. */
export async function safeGetAppsInTossOperationalEnvironment({
  getOperationalEnvironment,
  loadSdk = loadWebSdk,
}: SafeGetAppsInTossOperationalEnvironmentOptions = {}) {
  if (getOperationalEnvironment) return readOperationalEnvironment(getOperationalEnvironment);
  const sdk = await optionalSdk(loadSdk);
  return readOperationalEnvironment(() => sdk?.Environment?.environment);
}

export async function safeGetAppsInTossPlatformOS({
  getPlatformOS,
  loadSdk = loadWebSdk,
}: SafeGetAppsInTossPlatformOSOptions = {}) {
  if (getPlatformOS) return readPlatformOS(getPlatformOS);
  const sdk = await optionalSdk(loadSdk);
  return readPlatformOS(() => sdk?.Device?.os);
}

export async function safeGetAppsInTossAppVersion({
  getTossAppVersion,
  loadSdk = loadWebSdk,
}: SafeGetAppsInTossAppVersionOptions = {}) {
  if (getTossAppVersion) return readAppVersion(getTossAppVersion);
  const sdk = await optionalSdk(loadSdk);
  return readAppVersion(() => sdk?.Environment?.tossAppVersion);
}

/** A missing or stalled network probe resolves "UNKNOWN" within `timeoutMs`. */
export async function safeGetAppsInTossNetworkStatus({
  getNetworkStatus,
  loadSdk = loadWebSdk,
  timeoutMs = 3_000,
}: SafeGetAppsInTossNetworkStatusOptions = {}): Promise<unknown> {
  return readNetworkStatusWithin(async () => {
    if (getNetworkStatus) return getNetworkStatus();
    const environment = (await loadSdk()).Environment;
    return environment?.getNetworkStatus ? environment.getNetworkStatus() : "UNKNOWN";
  }, timeoutMs);
}

/** A missing, throwing or non-boolean SDK check reports unsupported. */
export async function isAppsInTossRuntimeSupported({
  isMinVersionSupported,
  loadSdk = loadWebSdk,
  minAndroid = "always",
  minIos = "always",
}: IsAppsInTossRuntimeSupportedOptions = {}) {
  const check = isMinVersionSupported ?? (await optionalSdk(loadSdk))?.isMinVersionSupported;
  return readMinVersionSupported(check, minAndroid, minIos);
}
