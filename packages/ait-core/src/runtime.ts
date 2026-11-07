// Runtime vocabulary shared by the RN and WebView runtime helpers. Each adapter
// owns SDK acquisition; a missing or throwing probe is always "unknown", never
// production.

export type AppsInTossOperationalEnvironment = "sandbox" | "toss" | "unknown";
export type AppsInTossPlatformOS = "android" | "ios" | "unknown";
export type AppsInTossMinVersionRequirement =
  | `${number}.${number}.${number}`
  | "always"
  | "never";

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
