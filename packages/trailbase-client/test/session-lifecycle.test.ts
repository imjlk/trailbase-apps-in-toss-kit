import { expect, test } from "bun:test";
import { createAppsInTossSessionManager, StaleAppSessionOperationError, AppSessionStorageIncompleteError, type AppsInTossSessionManagerOptions } from "../src/index";
import { createAppsInTossSessionLifecycle } from "../src/session-lifecycle";

type User = { id: string };
const response = (id: string) => ({ authToken: `auth-${id}`, refreshToken: `refresh-${id}`, user: { id } });
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function until(predicate: () => boolean) {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  throw new Error("Test operation did not reach its checkpoint");
}
function setup(overrides: Partial<AppsInTossSessionManagerOptions<User>> = {}) {
  const stored = new Map<string, string>();
  const manager = createAppsInTossSessionManager<User>({
    storage: { getItem: key => stored.get(key) ?? null, setItem: (key, value) => { stored.set(key, value); } },
    appLogin: async () => ({ authorizationCode: "code-B", referrer: "SANDBOX" }),
    createAnonymousHash: () => "anon-fixed",
    bootstrap: async () => response("A"),
    completeTossLogin: async () => response("B"),
    loadSession: async input => response(input.authTokens?.authToken.replace("auth-", "") ?? "A"),
    ...overrides,
  });
  return { manager, stored };
}

test("late anonymous bootstrap cannot overwrite a completed Toss login", async () => {
  const late = deferred<ReturnType<typeof response>>();
  let started = false;
  let signal: AbortSignal | undefined;
  const { manager, stored } = setup({ bootstrap: async (_hash, options) => { started = true; signal = options?.signal; return late.promise; } });
  const first = manager.bootstrapAnonymousSession().catch(error => error);
  await until(() => started);
  const second = await manager.signInWithToss();
  expect(second.user.id).toBe("B");
  expect(signal?.aborted).toBe(true);
  expect(await first).toBeInstanceOf(StaleAppSessionOperationError);
  late.resolve(response("A"));
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(JSON.parse(stored.get("trailbase.appSession")!).user.id).toBe("B");
});

test("serialized storage writes leave the new account last even if an older write cannot abort", async () => {
  const values = new Map<string, string>();
  const slowWrite = deferred<void>();
  let writing = false;
  const { manager } = setup({ storage: {
    getItem: key => values.get(key) ?? null,
    async setItem(key, value) {
      if (key === "trailbase.appSession" && value.includes('"id":"A"')) { writing = true; await slowWrite.promise; }
      values.set(key, value);
    },
  } });
  const first = manager.bootstrapAnonymousSession().catch(error => error);
  await until(() => writing);
  const second = manager.signInWithToss();
  expect(await first).toBeInstanceOf(StaleAppSessionOperationError);
  slowWrite.resolve();
  await second;
  expect(JSON.parse(values.get("trailbase.appSession")!).user.id).toBe("B");
  expect(JSON.parse(values.get("trailbase.tossSession")!).user.id).toBe("B");
});

test("disconnect fences a pending session restore, including its failure cleanup", async () => {
  const late = deferred<ReturnType<typeof response>>();
  let loading = false;
  const { manager, stored } = setup({ loadSession: async () => { loading = true; return late.promise; } });
  await manager.signInWithToss();
  const restore = manager.restoreStoredAppSession().catch(error => error);
  await until(() => loading);
  await manager.clearSessions();
  late.resolve(response("B"));
  expect(await restore).toBeInstanceOf(StaleAppSessionOperationError);
  expect(stored.get("trailbase.appSession")).toBe("");
  expect(stored.get("trailbase.tossSession")).toBe("");
});

test("cancelled login preflight cannot open a late native login dialog", async () => {
  const preflight = deferred<boolean>();
  let checking = false;
  let dialogs = 0;
  const { manager } = setup({
    getIsTossLoginIntegratedService: async () => { checking = true; return preflight.promise; },
    appLogin: async () => { dialogs++; return { authorizationCode: "late" }; },
  });
  const login = manager.signInWithToss().catch(error => error);
  await until(() => checking);
  await manager.clearSessions();
  preflight.resolve(true);
  expect(await login).toBeInstanceOf(StaleAppSessionOperationError);
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(dialogs).toBe(0);
});

test("superseding between mirrored writes or clears cannot restore the previous account", async () => {
  for (const clearing of [false, true]) {
    const values = new Map<string, string>();
    const middle = deferred<void>();
    let paused = false;
    let block = false;
    const { manager } = setup({ storage: {
      getItem: key => values.get(key) ?? null,
      async setItem(key, value) {
        values.set(key, value);
        if (block && key === "trailbase.tossSession") { paused = true; await middle.promise; }
      },
    } });
    await manager.bootstrapAnonymousSession();
    block = true;
    const first = (clearing ? manager.clearSessions() : manager.signInWithToss()).catch(error => error);
    await until(() => paused);
    const restore = manager.restoreStoredAppSession();
    block = false;
    middle.resolve();
    expect(await first).toBeInstanceOf(StaleAppSessionOperationError);
    const restored = await restore;
    expect(restored?.user.id ?? null).toBe(clearing ? null : "B");
  }
});

test("a failed mirrored save leaves a durable marker and requires explicit recovery", async () => {
  const values = new Map<string, string>();
  let failWrite = false;
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem(key: string, value: string) {
      if (failWrite && key === "trailbase.appSession") throw new Error("storage unavailable");
      values.set(key, value);
    },
  };
  const { manager } = setup({ storage, loadSession: async () => response("B") });
  await manager.bootstrapAnonymousSession();
  failWrite = true;
  await expect(manager.signInWithToss()).rejects.toThrow("storage unavailable");
  expect(values.get("trailbase.appSession.writePending")).toBe("1");
  const restarted = setup({ storage }).manager;
  await expect(restarted.getOrCreateAppSession()).rejects.toBeInstanceOf(AppSessionStorageIncompleteError);
  failWrite = false;
  await restarted.clearSessions();
  expect(values.get("trailbase.appSession.writePending")).toBe("");
  expect(await restarted.restoreStoredAppSession()).toBeNull();
  await manager.signInWithToss();
  failWrite = true;
  await expect(manager.restoreStoredTossSession()).rejects.toThrow("storage unavailable");
  expect(values.get("trailbase.appSession.writePending")).toBe("1");
});

test("failure before acquiring a scope clears caches once", async () => {
  const { manager } = setup({ bootstrap: async () => { throw new Error("offline"); } });
  let clears = 0;
  const lifecycle = createAppsInTossSessionLifecycle({ manager, getUserId: user => user.id,
    clearUserData: () => { clears++; }, refreshEntitlements: async () => null });
  await expect(lifecycle.start()).rejects.toThrow("offline");
  expect(clears).toBe(1);
  expect(lifecycle.getSnapshot().phase).toBe("error");
  await lifecycle.dispose();
  expect(() => lifecycle.subscribe(() => {})).toThrow("disposed");
});

test("get-or-sign-in recovers incomplete storage through fresh Toss login without anonymous fallback", async () => {
  let logins = 0;
  let bootstraps = 0;
  const { manager, stored } = setup({
    appLogin: async () => { logins++; return { authorizationCode: "fresh", referrer: "DEFAULT" }; },
    bootstrap: async () => { bootstraps++; return response("anonymous"); },
  });
  stored.set("trailbase.appSession.writePending", "1");
  const session = await manager.getOrSignInWithToss();
  expect(session.user.id).toBe("B");
  expect(logins).toBe(1);
  expect(bootstraps).toBe(0);
  expect(stored.get("trailbase.appSession.writePending")).toBe("");
});

test("account transition clears resources, isolates cache keys and ignores late request/SSE updates", async () => {
  const { manager } = setup();
  const events: string[] = [];
  const lifecycle = createAppsInTossSessionLifecycle({
    manager, getUserId: user => user.id,
    clearUserData: async () => { events.push("clear"); },
    refreshEntitlements: async scope => { events.push(`entitlements:${scope.userId}`); return { paid: scope.userId === "B" }; },
    reconcilePending: async scope => { events.push(`pending:${scope.userId}`); },
  });
  const a = (await lifecycle.start())!;
  const late = deferred<number>();
  let requestStarted = false;
  const pending = a.run(async () => { requestStarted = true; return late.promise; }).catch(error => error);
  await until(() => requestStarted);
  let closed = false;
  await a.registerCleanup(() => { closed = true; events.push("close:A"); });
  const transition = lifecycle.signInWithToss();
  expect(lifecycle.getSnapshot().phase).toBe("transitioning");
  expect(lifecycle.getSnapshot().scope).toBeNull();
  expect(lifecycle.getSnapshot().entitlements).toBeNull();
  let visibleBalance = 0;
  expect(a.commit(() => { visibleBalance = 100; })).toBe(false);
  const b = (await transition)!;
  expect(closed).toBe(true);
  expect(await pending).toBeInstanceOf(StaleAppSessionOperationError);
  late.resolve(100);
  expect(visibleBalance).toBe(0);
  expect(a.cacheKey("balance")).not.toEqual(b.cacheKey("balance"));
  expect(events.indexOf("close:A")).toBeLessThan(events.indexOf("entitlements:B"));
  expect(lifecycle.getSnapshot().entitlements).toEqual({ paid: true });
  expect(events.at(-1)).toBe("pending:B");
  await lifecycle.dispose();
});

test("resume revalidates entitlements and pending work before ready and invalidates the prior same-user scope", async () => {
  const { manager } = setup();
  const refreshed = deferred<{ paid: boolean }>();
  let calls = 0;
  const lifecycle = createAppsInTossSessionLifecycle({
    manager, getUserId: user => user.id, clearUserData: () => {},
    refreshEntitlements: async () => ++calls === 1 ? { paid: true } : refreshed.promise,
  });
  const first = (await lifecycle.start())!;
  const resume = lifecycle.resume();
  await until(() => calls === 2);
  expect(first.isCurrent()).toBe(false);
  expect(lifecycle.getSnapshot().entitlements).toBeNull();
  refreshed.resolve({ paid: false });
  const current = (await resume)!;
  expect(current.userId).toBe(first.userId);
  expect(current.cacheKey("balance")).not.toEqual(first.cacheKey("balance"));
  expect(lifecycle.getSnapshot().entitlements).toEqual({ paid: false });
  await lifecycle.disconnect();
  await expect(lifecycle.resume()).rejects.toThrow("Stored session is unavailable");
  expect(lifecycle.getSnapshot().phase).toBe("error");
  await lifecycle.dispose();
});

test("cleanup failure leaves no current data, does not skip other disposers, and can be retried", async () => {
  const { manager } = setup();
  const lifecycle = createAppsInTossSessionLifecycle({ manager, getUserId: user => user.id,
    clearUserData: () => {}, refreshEntitlements: async () => null });
  const scope = (await lifecycle.start())!;
  let disposed = false;
  await scope.registerCleanup(() => { throw new Error("cleanup failed"); });
  await scope.registerCleanup(() => { disposed = true; });
  await expect(lifecycle.signInWithToss()).rejects.toThrow();
  expect(disposed).toBe(true);
  expect(scope.signal.aborted).toBe(true);
  expect(lifecycle.getSnapshot().phase).toBe("error");
  expect(lifecycle.getSnapshot().scope).toBeNull();
  await lifecycle.signInWithToss();
  expect(lifecycle.getSnapshot().scope?.userId).toBe("B");
  await lifecycle.dispose();
});
