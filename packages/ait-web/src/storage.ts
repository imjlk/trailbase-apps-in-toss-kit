import { createWebStorage, type WebStorageOptions } from "@ait-kit/sdk/web";
import type { AppsInTossStorageBridge, KeyValueStorage } from "@trailbase-apps-in-toss-kit/trailbase-client";
import {
  createIdentityGuardedStorage,
  isAppsInTossAnonymousHash,
} from "@trailbase-apps-in-toss-kit/ait-core/internal/session-guard";
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

export interface CreateAppsInTossWebSessionStorageOptions {
  /** Usually `ait.storage`, which prefixes keys with `${appKey}.` like the RN session storage. */
  storage: KeyValueStorage;
  /**
   * Usually `ait.anonymousHash`. Used only to notice that the Toss account on
   * this device changed; WebView authentication still exchanges a fresh code.
   */
  resolveAnonymousHash: () => Promise<string>;
  /**
   * Re-check the Toss account on every session read. Defaults to true. False
   * trusts the stored account like the RN default and does not isolate accounts.
   */
  revalidateAnonymousHash?: boolean;
  /** False skips the guard for local development without the SDK. Defaults to true. */
  production?: boolean;
  anonymousHashStorageKey?: string;
  appSessionStorageKey?: string;
  tossSessionStorageKey?: string;
}

export interface AppsInTossWebSessionStorage {
  anonymousHashStorageKey: string;
  appSessionStorageKey: string;
  storage: KeyValueStorage;
  tossSessionStorageKey: string;
}

/**
 * Session storage with the RN account check. Session reads return null and
 * clear both session keys when the Toss account changed, so the app
 * authenticates again with a fresh code instead of restoring another
 * account's session. The default keys read what the RN session storage wrote.
 * Saving a session before any account is recorded (for example
 * `adoptAppSession` on a first launch) records the current account first, so
 * the next read keeps it. A failed account lookup, or one that does not answer
 * within 10 seconds, rejects the read or save without recording an account;
 * treat a rejected read as no stored session.
 */
export function createAppsInTossWebSessionStorage({
  storage,
  resolveAnonymousHash,
  revalidateAnonymousHash = true,
  production = true,
  anonymousHashStorageKey = "anonymousHash",
  appSessionStorageKey = "appSession",
  tossSessionStorageKey = "tossSession",
}: CreateAppsInTossWebSessionStorageOptions): AppsInTossWebSessionStorage {
  if (!storage || typeof storage.getItem !== "function" || typeof storage.setItem !== "function" ||
      typeof resolveAnonymousHash !== "function") {
    throw new TypeError("Apps in Toss WebView session storage needs storage and resolveAnonymousHash.");
  }
  const keys = [anonymousHashStorageKey, appSessionStorageKey, tossSessionStorageKey];
  if (keys.some((key) => typeof key !== "string" || !key.trim()) || new Set(keys).size !== keys.length) {
    throw new TypeError("Apps in Toss WebView session storage keys must be distinct non-empty strings.");
  }
  return {
    anonymousHashStorageKey,
    appSessionStorageKey,
    storage: createIdentityGuardedStorage(storage, {
      anonymousHashStorageKey,
      appSessionStorageKey: [appSessionStorageKey, tossSessionStorageKey],
      production,
      revalidate: production && revalidateAnonymousHash,
      resolveAnonymousHash: async () => {
        const hash = await resolveAnonymousHash();
        if (!isAppsInTossAnonymousHash(hash)) throw new TypeError("Apps in Toss anonymous hash is invalid.");
        return hash;
      },
    }),
    tossSessionStorageKey,
  };
}
