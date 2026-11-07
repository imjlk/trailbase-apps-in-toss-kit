import {
  StaleAppSessionOperationError,
  type KeyValueStorage,
} from "@trailbase-apps-in-toss-kit/trailbase-client";

// Shared by the RN session storage and the WebView session storage. The stored
// anonymous hash only detects that the Toss account on this device changed;
// it never authenticates a caller.

export const APPS_IN_TOSS_ANONYMOUS_HASH_PREFIX = "ait:";

export function isAppsInTossAnonymousHash(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.startsWith(APPS_IN_TOSS_ANONYMOUS_HASH_PREFIX) &&
    value.slice(APPS_IN_TOSS_ANONYMOUS_HASH_PREFIX.length).trim().length > 0
  );
}

/** @internal */
export interface IdentityGuardedStorageOptions {
  anonymousHashStorageKey: string;
  appSessionStorageKey: string | readonly string[];
  production: boolean;
  /** Production only: resolve the SDK identity on every session read and clear sessions on change. */
  revalidate: boolean;
  resolveAnonymousHash: () => Promise<string>;
}

/**
 * @internal In production, a session read first checks the stored anonymous
 * hash. When it is missing, invalid or (with `revalidate`) different from the
 * SDK identity, every session key is cleared before the new hash is stored and
 * the read returns null, so the app authenticates again instead of restoring
 * another account's session.
 */
export function createIdentityGuardedStorage(
  storage: KeyValueStorage,
  {
    anonymousHashStorageKey,
    appSessionStorageKey,
    production,
    revalidate,
    resolveAnonymousHash,
  }: IdentityGuardedStorageOptions,
): KeyValueStorage {
  let writeTail: Promise<void> = Promise.resolve();
  function checkActive(signal?: AbortSignal) {
    if (signal?.aborted) throw new StaleAppSessionOperationError();
  }
  function write(key: string, value: string, signal?: AbortSignal) {
    const result = writeTail.then(() => { checkActive(signal); return storage.setItem(key, value); });
    // Include identity invalidation and normal session writes in the same queue.
    writeTail = result.catch(() => {});
    return result;
  }
  async function resolveStoredAnonymousHash(signal?: AbortSignal) {
    const existing = await storage.getItem(anonymousHashStorageKey);
    checkActive(signal);
    if (!revalidate && existing && (!production || isAppsInTossAnonymousHash(existing))) {
      return { refreshed: false, value: existing };
    }

    const next = await resolveAnonymousHash();
    checkActive(signal);
    if (revalidate && existing !== next) {
      // Clear every credential mirror before publishing the new identity. If a
      // write fails the old identity remains, so the next attempt repeats cleanup.
      const keys = typeof appSessionStorageKey === "string" ? [appSessionStorageKey] : appSessionStorageKey;
      for (const key of keys) await write(key, "", signal);
    }
    if (existing !== next) await write(anonymousHashStorageKey, next, signal);
    checkActive(signal);
    return { refreshed: existing !== next, value: next };
  }

  async function read(key: string, signal?: AbortSignal) {
    await writeTail;
    checkActive(signal);
    if (key === anonymousHashStorageKey) {
      return (await resolveStoredAnonymousHash(signal)).value;
    }
    if (production && isAppSessionStorageKey(key, appSessionStorageKey)) {
      const { refreshed } = await resolveStoredAnonymousHash(signal);
      if (refreshed) return null;
    }
    return storage.getItem(key);
  }
  return {
    getItem: key => read(key),
    getItemWithSignal: (key, signal) => read(key, signal),
    setItem: (key, value) => write(key, value),
  };
}

function isAppSessionStorageKey(
  key: string,
  appSessionStorageKey: string | readonly string[],
) {
  if (Array.isArray(appSessionStorageKey)) {
    return appSessionStorageKey.includes(key);
  }
  return key === appSessionStorageKey;
}
