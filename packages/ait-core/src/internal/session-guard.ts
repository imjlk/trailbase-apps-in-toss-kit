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
 * SDK identity, the new hash is stored and the read returns null, so the app
 * authenticates again instead of restoring another account's session. With
 * `revalidate`, every session key is cleared before the new hash is stored.
 * A session saved before any account is recorded records the current account
 * first, so the next read keeps it.
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
  const sessionKeys: readonly string[] = typeof appSessionStorageKey === "string"
    ? [appSessionStorageKey]
    : appSessionStorageKey;
  // Identity changes and every write share one queue, so a step that reads
  // the stored identity and then writes cannot interleave with another write.
  let queueTail: Promise<void> = Promise.resolve();
  function checkActive(signal?: AbortSignal) {
    if (signal?.aborted) throw new StaleAppSessionOperationError();
  }
  function enqueue<T>(task: () => Promise<T>) {
    const result = queueTail.then(task);
    queueTail = result.then(() => {}, () => {});
    return result;
  }
  /** Runs inside the queue. */
  async function switchIdentity(next: string, signal?: AbortSignal) {
    // Clear every credential mirror before publishing the new identity. If a
    // write fails the old identity remains, so the next attempt repeats cleanup.
    // Without `revalidate` the stored identity is trusted and nothing is
    // cleared: a replaced legacy hash only hides the session for one read.
    if (revalidate) {
      for (const key of sessionKeys) {
        checkActive(signal);
        await storage.setItem(key, "");
      }
    }
    checkActive(signal);
    await storage.setItem(anonymousHashStorageKey, next);
  }
  /**
   * Compare and switch as one queued step: a read that saw the same old
   * identity but resolved later must not clear a session saved after the
   * first switch. Resolves whether this call switched the identity.
   */
  function publishIdentity(next: string, signal?: AbortSignal) {
    return enqueue(async () => {
      checkActive(signal);
      if (await storage.getItem(anonymousHashStorageKey) === next) return false;
      await switchIdentity(next, signal);
      return true;
    });
  }
  function write(key: string, value: string) {
    return enqueue(async () => {
      if (production && value && sessionKeys.includes(key) &&
          !isAppsInTossAnonymousHash(await storage.getItem(anonymousHashStorageKey))) {
        // No account is recorded yet (for example a session adopted before any
        // read). Record the current one first, or the next read would treat
        // this session as another account's and clear it.
        await switchIdentity(await resolveAnonymousHash());
      }
      await storage.setItem(key, value);
    });
  }
  async function resolveStoredAnonymousHash(signal?: AbortSignal) {
    const existing = await storage.getItem(anonymousHashStorageKey);
    checkActive(signal);
    if (!revalidate && existing && (!production || isAppsInTossAnonymousHash(existing))) {
      return { refreshed: false, value: existing };
    }

    const next = await resolveAnonymousHash();
    checkActive(signal);
    const refreshed = existing !== next && await publishIdentity(next, signal);
    checkActive(signal);
    return { refreshed, value: next };
  }

  async function read(key: string, signal?: AbortSignal) {
    await queueTail;
    checkActive(signal);
    if (key === anonymousHashStorageKey) {
      return (await resolveStoredAnonymousHash(signal)).value;
    }
    if (production && sessionKeys.includes(key)) {
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
