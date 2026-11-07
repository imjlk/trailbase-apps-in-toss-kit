import {
  createShareBridge,
  type AppsInTossShareBridge,
  type CreateAppsInTossShareBridgeOptions as CoreShareBridgeOptions,
} from "@trailbase-apps-in-toss-kit/ait-core/share";
export * from "@trailbase-apps-in-toss-kit/ait-core/share";

type WebShareSdk = Pick<typeof import("@apps-in-toss/web-framework"), "getSchemeUri" | "getTossShareLink" | "share">;

export interface CreateAppsInTossShareBridgeOptions extends CoreShareBridgeOptions {
  /** Resolve from the consumer's SDK dependency; never acquires the RN SDK. */
  loadSdk?: () => Promise<Partial<WebShareSdk>>;
}

/** Same deep-link, OG prewarm and message behavior as RN, with SDK 3 acquisition only. */
export function createAppsInTossShareBridge({
  loadSdk = () => import("@apps-in-toss/web-framework"),
  ...options
}: CreateAppsInTossShareBridgeOptions = {}): AppsInTossShareBridge {
  const resolve = async <K extends keyof WebShareSdk>(key: K): Promise<WebShareSdk[K] | undefined> => {
    try {
      return (await loadSdk())[key];
    } catch {
      return undefined;
    }
  };
  return createShareBridge(options, {
    getSchemeUri: () => resolve("getSchemeUri"),
    getTossShareLink: () => resolve("getTossShareLink"),
    share: () => resolve("share"),
  });
}
