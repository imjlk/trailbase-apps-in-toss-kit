import {
  createShareBridge,
  type AppsInTossOgPrewarmFetcher,
  type AppsInTossShareBridge,
} from "@trailbase-apps-in-toss-kit/ait-core/share";
import {
  defaultFrameworkFunction,
  type AppsInTossGetSchemeUri,
  type AppsInTossGetTossShareLink,
  type AppsInTossShare,
} from "./internal/framework";

// Deep-link, OG image and message helpers are shared with WebView through ait-core.
export * from "@trailbase-apps-in-toss-kit/ait-core/share";
export type {
  AppsInTossGetSchemeUri,
  AppsInTossGetTossShareLink,
  AppsInTossShare,
} from "./internal/framework";

// Keep the RN SDK's own function types on the existing options type.
export interface CreateAppsInTossShareBridgeOptions {
  fetcher?: AppsInTossOgPrewarmFetcher;
  getSchemeUri?: AppsInTossGetSchemeUri;
  getTossShareLink?: AppsInTossGetTossShareLink;
  ogPrewarmTimeoutMs?: number;
  share?: AppsInTossShare;
}

export function createAppsInTossShareBridge(
  options: CreateAppsInTossShareBridgeOptions = {},
): AppsInTossShareBridge {
  return createShareBridge(options, {
    getSchemeUri: () => defaultFrameworkFunction("getSchemeUri"),
    getTossShareLink: () => defaultFrameworkFunction("getTossShareLink"),
    share: () => defaultFrameworkFunction("share"),
  });
}
