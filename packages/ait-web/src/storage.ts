import { createWebStorage, type WebStorageOptions } from "@ait-kit/sdk/web";
import type { AppsInTossStorageBridge } from "@trailbase-apps-in-toss-kit/trailbase-client";
export * from "@trailbase-apps-in-toss-kit/ait-core/storage";

/** Verbatim SDK Storage keys for consumers migrating existing persisted state. No browser fallback. */
export function createAppsInTossSdkStorageBridge(options: WebStorageOptions = {}): AppsInTossStorageBridge {
  const storage = createWebStorage(options);
  return {
    getItem: (key) => storage.get(key),
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.remove(key),
  };
}
