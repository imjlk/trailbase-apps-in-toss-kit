import {
  defaultFrameworkFunction,
  type AppsInTossGetOperationalEnvironment,
  type AppsInTossGetPlatformOS,
  type AppsInTossGetTossAppVersion,
  type AppsInTossIsMinVersionSupported,
} from "./internal/framework";

export type AppsInTossOperationalEnvironment = "sandbox" | "toss" | "unknown";
export type AppsInTossPlatformOS = "android" | "ios" | "unknown";
export type AppsInTossMinVersionRequirement =
  | `${number}.${number}.${number}`
  | "always"
  | "never";

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
}: SafeGetAppsInTossOperationalEnvironmentOptions = {}): Promise<AppsInTossOperationalEnvironment> {
  const resolvedGetOperationalEnvironment =
    getOperationalEnvironment ??
    (await defaultFrameworkFunction("getOperationalEnvironment"));

  try {
    const result = resolvedGetOperationalEnvironment?.();
    return result === "sandbox" || result === "toss" ? result : "unknown";
  } catch {
    return "unknown";
  }
}

export async function safeGetAppsInTossPlatformOS({
  getPlatformOS,
}: SafeGetAppsInTossPlatformOSOptions = {}): Promise<AppsInTossPlatformOS> {
  const resolvedGetPlatformOS =
    getPlatformOS ?? (await defaultFrameworkFunction("getPlatformOS"));

  try {
    const result = resolvedGetPlatformOS?.();
    return result === "android" || result === "ios" ? result : "unknown";
  } catch {
    return "unknown";
  }
}

export async function safeGetAppsInTossAppVersion({
  getTossAppVersion,
}: SafeGetAppsInTossAppVersionOptions = {}): Promise<string | null> {
  const resolvedGetTossAppVersion =
    getTossAppVersion ?? (await defaultFrameworkFunction("getTossAppVersion"));

  try {
    const result = resolvedGetTossAppVersion?.();
    return typeof result === "string" && result.trim() ? result.trim() : null;
  } catch {
    return null;
  }
}

export async function isAppsInTossRuntimeSupported({
  isMinVersionSupported,
  minAndroid = "always",
  minIos = "always",
}: IsAppsInTossRuntimeSupportedOptions = {}) {
  const resolvedIsMinVersionSupported =
    isMinVersionSupported ??
    (await defaultFrameworkFunction("isMinVersionSupported"));
  if (!resolvedIsMinVersionSupported) {
    return false;
  }

  try {
    return resolvedIsMinVersionSupported({
      android: minAndroid,
      ios: minIos,
    });
  } catch {
    return false;
  }
}

export function isAppsInTossSandbox(
  operationalEnvironment?: AppsInTossOperationalEnvironment | null,
) {
  return operationalEnvironment === "sandbox";
}

export function isAppsInTossProductionRuntime(
  operationalEnvironment?: AppsInTossOperationalEnvironment | null,
) {
  return operationalEnvironment === "toss";
}
