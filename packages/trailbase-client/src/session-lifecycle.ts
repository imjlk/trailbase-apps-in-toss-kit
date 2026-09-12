import type { createAppsInTossSessionManager } from "./index";
import { abortableSessionOperation, createSessionOperationGuard, StaleAppSessionOperationError, type SessionOperation } from "./session-operation";

type Manager<TUser> = ReturnType<typeof createAppsInTossSessionManager<TUser>>;
export type ManagedAppSession<TUser> = Awaited<ReturnType<Manager<TUser>["signInWithToss"]>>;

export interface AppUserScope<TUser> {
  readonly userId: string;
  readonly revision: number;
  readonly session: ManagedAppSession<TUser>;
  readonly signal: AbortSignal;
  isCurrent(): boolean;
  cacheKey(...parts: readonly unknown[]): readonly unknown[];
  run<T>(task: (scope: AppUserScope<TUser>) => Promise<T>): Promise<T>;
  commit(update: () => void): boolean;
  registerCleanup(cleanup: () => void | Promise<void>): Promise<void>;
}

export type AppSessionLifecycleSnapshot<TUser, TEntitlements> = {
  phase: "idle" | "transitioning" | "ready" | "error" | "disposed";
  revision: number;
  scope: AppUserScope<TUser> | null;
  entitlements: TEntitlements | null;
};

export interface AppsInTossSessionLifecycleOptions<TUser, TEntitlements> {
  manager: Manager<TUser>;
  getUserId(user: TUser): string;
  /** Cancel and remove the app's user-scoped query/collection caches. */
  clearUserData(): void | Promise<void>;
  /** Read authoritative backend entitlements; do not use cached SDK status. */
  refreshEntitlements(scope: AppUserScope<TUser>): Promise<TEntitlements>;
  /** Query pending work for this principal; never blindly resend/grant. */
  reconcilePending?(scope: AppUserScope<TUser>): Promise<void>;
}

export function createAppsInTossSessionLifecycle<TUser, TEntitlements>({
  manager, getUserId, clearUserData, refreshEntitlements, reconcilePending,
}: AppsInTossSessionLifecycleOptions<TUser, TEntitlements>) {
  const operations = createSessionOperationGuard();
  const listeners = new Set<() => void>();
  let revision = 0;
  let disposed = false;
  let active: { scope: AppUserScope<TUser>; close(): Promise<void> } | null = null;
  let cleanupTail: Promise<void> = Promise.resolve();
  let snapshot: AppSessionLifecycleSnapshot<TUser, TEntitlements> = {
    phase: "idle", revision, scope: null, entitlements: null,
  };

  function publish(phase: typeof snapshot.phase, scope: AppUserScope<TUser> | null = null, entitlements: TEntitlements | null = null) {
    snapshot = Object.freeze({ phase, revision, scope, entitlements });
    for (const listener of listeners) listener();
  }

  function closeActive() {
    const previous = active;
    active = null;
    const result = cleanupTail.catch(() => {}).then(async () => {
      const results = await Promise.allSettled([previous?.close(), Promise.resolve().then(clearUserData)]);
      const errors = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
      if (errors.length) throw new AggregateError(errors.map(r => r.reason), "User resource cleanup failed");
    });
    cleanupTail = result;
    return result;
  }

  function userScope(session: ManagedAppSession<TUser>, operation: SessionOperation, ownRevision: number) {
    const userId = getUserId(session.user);
    if (typeof userId !== "string" || !userId.trim()) throw new Error("Backend session needs a stable TrailBase principal ID");
    const cleanups = new Set<() => void | Promise<void>>();
    const controller = new AbortController();
    const abort = () => controller.abort();
    operation.signal.addEventListener("abort", abort, { once: true });
    if (operation.signal.aborted) abort();
    let closed = false;
    const scope: AppUserScope<TUser> = Object.freeze({
      userId, revision: ownRevision, session, signal: controller.signal,
      isCurrent: () => !closed && !controller.signal.aborted && ownRevision === revision && !disposed,
      cacheKey: (...parts: readonly unknown[]) => ["trailbase-user", userId, ownRevision, ...parts],
      async run<T>(task: (scope: AppUserScope<TUser>) => Promise<T>) {
        if (!scope.isCurrent()) throw new StaleAppSessionOperationError();
        operation.check();
        const result = await abortableSessionOperation(Promise.resolve().then(() => {
          if (!scope.isCurrent()) throw new StaleAppSessionOperationError();
          operation.check(); return task(scope);
        }), scope.signal);
        operation.check();
        return result;
      },
      commit(update: () => void) {
        if (!scope.isCurrent() || snapshot.phase !== "ready" || snapshot.scope !== scope) return false;
        update();
        return true;
      },
      async registerCleanup(cleanup: () => void | Promise<void>) {
        if (closed || scope.signal.aborted) await cleanup();
        else cleanups.add(cleanup);
      },
    });
    return { scope, async close() {
      closed = true;
      controller.abort();
      operation.signal.removeEventListener("abort", abort);
      const results = await Promise.allSettled([...cleanups].map(fn => Promise.resolve().then(fn)));
      cleanups.clear();
      const errors = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
      if (errors.length) throw new AggregateError(errors.map(r => r.reason), "User subscription cleanup failed");
    } };
  }

  function transition(acquire: (() => Promise<ManagedAppSession<TUser> | null>) | null) {
    if (disposed) return Promise.reject(new Error("Session lifecycle is disposed"));
    manager.cancelPendingOperations();
    operations.cancel();
    revision++;
    const ownRevision = revision;
    const cleanup = closeActive();
    publish("transitioning");
    return operations.run(async operation => {
      try {
        await cleanup;
        operation.check();
        if (!acquire) {
          await manager.clearSessions();
          operation.check();
          publish("idle");
          return null;
        }
        const session = await acquire();
        operation.check();
        if (!session) throw new Error("Stored session is unavailable; explicit sign-in or bootstrap is required");
        active = userScope(session, operation, ownRevision);
        const scope = active.scope;
        const entitlements = await scope.run(refreshEntitlements);
        if (reconcilePending) await scope.run(reconcilePending);
        operation.check();
        publish("ready", scope, entitlements);
        return scope;
      } catch (error) {
        operation.check();
        let failure = error;
        try { await closeActive(); }
        catch (cleanupError) { failure = new AggregateError([error, cleanupError], "Session transition and cleanup failed"); }
        operation.check();
        publish("error");
        throw failure;
      }
    });
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    start: () => transition(manager.getOrCreateAppSession),
    signInWithToss: () => transition(manager.signInWithToss),
    resume: () => transition(manager.restoreStoredAppSession),
    disconnect: () => transition(null),
    async dispose() {
      if (disposed) return await cleanupTail;
      disposed = true;
      revision++;
      manager.cancelPendingOperations();
      operations.cancel();
      const cleanup = closeActive();
      publish("disposed");
      listeners.clear();
      await cleanup;
    },
  };
}
