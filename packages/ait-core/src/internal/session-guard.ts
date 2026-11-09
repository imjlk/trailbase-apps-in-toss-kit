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
  /** Bound on every SDK account lookup a read or save makes. */
  lookupTimeoutMs?: number;
}

/**
 * Reads and saves give up on a stalled SDK account lookup, so session restore
 * settles and queued clears still run.
 */
export const DEFAULT_ACCOUNT_LOOKUP_TIMEOUT_MS = 10_000;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("Apps in Toss account lookup timed out.")), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * @internal In production, a session read first checks the stored anonymous
 * hash. When it is missing, invalid or (with `revalidate`) different from the
 * SDK identity, the new hash is stored and the read returns null, so the app
 * authenticates again instead of restoring another account's session. With
 * `revalidate`, every session key is cleared before the new hash is stored.
 * A session saved before any account is recorded records the current account
 * first, so the next read keeps it. With `revalidate`, a session saved before
 * a read has confirmed the account in this process (for example after a
 * failed or timed-out read) checks the account the same way and switches the
 * stored identity if it changed, so a later read as the previous account
 * never restores it. Every account lookup is bounded: on timeout a read
 * rejects without recording an account or clearing anything, and a save
 * rejects without writing, so later writes such as a logout clear proceed.
 * A late SDK answer is ignored.
 */
export function createIdentityGuardedStorage(
  storage: KeyValueStorage,
  {
    anonymousHashStorageKey,
    appSessionStorageKey,
    production,
    revalidate,
    resolveAnonymousHash,
    lookupTimeoutMs = DEFAULT_ACCOUNT_LOOKUP_TIMEOUT_MS,
  }: IdentityGuardedStorageOptions,
): KeyValueStorage {
  const lookupAccount = () => withTimeout(resolveAnonymousHash(), lookupTimeoutMs);
  const sessionKeys: readonly string[] = typeof appSessionStorageKey === "string"
    ? [appSessionStorageKey]
    : appSessionStorageKey;
  // Identity changes and every write share one queue, so a step that reads
  // the stored identity and then writes cannot interleave with another write.
  let queueTail: Promise<void> = Promise.resolve();
  // Whether a lookup in this process confirmed the stored identity. Until one
  // does, a session save under `revalidate` checks the account first: the app
  // may be saving another account's session after a failed read.
  let accountConfirmed = false;
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
      if (production && value && sessionKeys.includes(key)) {
        // No account is recorded yet (for example a session adopted before any
        // read), or none was confirmed in this process. Record the current one
        // first: otherwise the next read would clear this session as another
        // account's, or a read as the stored account would restore it. The
        // lookup runs inside the queue; its bound keeps a stalled SDK call from
        // holding a later logout clear, and a late answer from saving after it.
        const stored = await storage.getItem(anonymousHashStorageKey);
        if (!isAppsInTossAnonymousHash(stored) || (revalidate && !accountConfirmed)) {
          const next = await lookupAccount();
          if (next !== stored) await switchIdentity(next);
          accountConfirmed = true;
        }
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

    // Bounded so a stalled SDK call cannot hang session restore.
    const next = await lookupAccount();
    checkActive(signal);
    const refreshed = existing !== next && await publishIdentity(next, signal);
    // The stored identity now matches the SDK account.
    accountConfirmed = true;
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
