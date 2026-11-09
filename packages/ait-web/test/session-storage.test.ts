import { describe, expect, test } from "bun:test";
import { createIdentityGuardedStorage } from "@trailbase-apps-in-toss-kit/ait-core/internal/session-guard";
import type { KeyValueStorage } from "@trailbase-apps-in-toss-kit/trailbase-client";
import * as rnIdentity from "../../ait-rn/src/identity";
import { createAppsInTossSessionStorage } from "../../ait-rn/src/storage";
import { createAppsInTossWebSessionStorage } from "../src/storage";

const APP_KEY = "fixture-app";

/** One SDK Storage namespace: the RN bridge uses verbatim keys, ait.storage prefixes them. */
function sharedSdkStorage() {
  const raw = new Map<string, string>();
  const rnBridge = {
    getItem: async (key: string) => raw.get(key) ?? null,
    setItem: async (key: string, value: string) => { raw.set(key, value); },
    removeItem: async (key: string) => { raw.delete(key); },
  };
  const aitStorage: KeyValueStorage = {
    getItem: async (key) => raw.get(`${APP_KEY}.${key}`) ?? null,
    setItem: async (key, value) => { raw.set(`${APP_KEY}.${key}`, value); },
  };
  return { raw, rnBridge, aitStorage };
}

function webSession(aitStorage: KeyValueStorage, hash: () => Promise<string>, options: { production?: boolean } = {}) {
  let lookups = 0;
  const session = createAppsInTossWebSessionStorage({
    storage: aitStorage,
    resolveAnonymousHash: () => { lookups++; return hash(); },
    ...options,
  });
  return { session, lookups: () => lookups };
}

async function rnBundleWroteSession(rnBridge: ReturnType<typeof sharedSdkStorage>["rnBridge"]) {
  const rn = createAppsInTossSessionStorage({
    appKey: APP_KEY,
    storage: rnBridge,
    production: true,
    revalidateAnonymousHash: true,
    getAnonymousKey: async () => ({ type: "HASH" as const, hash: "account-a" }),
  });
  expect(await rn.storage.getItem(rn.anonymousHashStorageKey)).toBe("ait:account-a");
  await rn.storage.setItem(rn.appSessionStorageKey, "rn-app-session");
  await rn.storage.setItem(rn.tossSessionStorageKey, "rn-toss-session");
}

describe("WebView session storage", () => {
  test("restores the session the RN bundle stored for the same Toss account", async () => {
    const { raw, rnBridge, aitStorage } = sharedSdkStorage();
    await rnBundleWroteSession(rnBridge);
    const { session } = webSession(aitStorage, async () => "ait:account-a");
    expect(await session.storage.getItem(session.appSessionStorageKey)).toBe("rn-app-session");
    expect(await session.storage.getItem(session.tossSessionStorageKey)).toBe("rn-toss-session");
    expect(raw.get(`${APP_KEY}.anonymousHash`)).toBe("ait:account-a");
  });

  test("clears both sessions instead of restoring another account's session", async () => {
    const { raw, rnBridge, aitStorage } = sharedSdkStorage();
    await rnBundleWroteSession(rnBridge);
    const { session } = webSession(aitStorage, async () => "ait:account-b");
    expect(await session.storage.getItem(session.tossSessionStorageKey)).toBeNull();
    expect(raw.get(`${APP_KEY}.appSession`)).toBe("");
    expect(raw.get(`${APP_KEY}.tossSession`)).toBe("");
    expect(raw.get(`${APP_KEY}.anonymousHash`)).toBe("ait:account-b");
    // A session the WebView app saves for the new account is kept.
    await session.storage.setItem(session.appSessionStorageKey, "web-session-b");
    expect(await session.storage.getItem(session.appSessionStorageKey)).toBe("web-session-b");
  });

  test("a failed or malformed account lookup never returns the stored session", async () => {
    const { raw, rnBridge, aitStorage } = sharedSdkStorage();
    await rnBundleWroteSession(rnBridge);
    const failing = webSession(aitStorage, async () => { throw new Error("outside the Toss app"); }).session;
    await expect(failing.storage.getItem(failing.appSessionStorageKey)).rejects.toThrow("outside the Toss app");
    const malformed = webSession(aitStorage, async () => "account-a").session;
    await expect(malformed.storage.getItem(malformed.appSessionStorageKey)).rejects.toThrow(TypeError);
    expect(raw.get(`${APP_KEY}.appSession`)).toBe("rn-app-session");
    expect(raw.get(`${APP_KEY}.anonymousHash`)).toBe("ait:account-a");
  });

  test("a first launch without a stored account starts signed out", async () => {
    const { raw, aitStorage } = sharedSdkStorage();
    raw.set(`${APP_KEY}.appSession`, "orphaned-session");
    raw.set(`${APP_KEY}.tossSession`, "orphaned-toss-session");
    const { session } = webSession(aitStorage, async () => "ait:account-a");
    expect(await session.storage.getItem(session.appSessionStorageKey)).toBeNull();
    expect(raw.get(`${APP_KEY}.appSession`)).toBe("");
    expect(raw.get(`${APP_KEY}.tossSession`)).toBe("");
    // Later reads do not bring an orphaned session back.
    expect(await session.storage.getItem(session.appSessionStorageKey)).toBe("");
    expect(await session.storage.getItem(session.tossSessionStorageKey)).toBe("");
  });

  test("a session saved before any account is recorded survives the next read", async () => {
    const { raw, aitStorage } = sharedSdkStorage();
    raw.set(`${APP_KEY}.tossSession`, "orphaned-toss-session");
    const { session } = webSession(aitStorage, async () => "ait:account-a");
    await session.storage.setItem(session.appSessionStorageKey, "adopted-session");
    expect(raw.get(`${APP_KEY}.anonymousHash`)).toBe("ait:account-a");
    expect(raw.get(`${APP_KEY}.tossSession`)).toBe("");
    expect(await session.storage.getItem(session.appSessionStorageKey)).toBe("adopted-session");
    // Clearing a session never needs the account.
    const offline = webSession(sharedSdkStorage().aitStorage, async () => { throw new Error("no SDK"); });
    await offline.session.storage.setItem(offline.session.appSessionStorageKey, "");
    expect(offline.lookups()).toBe(0);
  });

  test("a stalled account lookup on save cannot hold a later clear or save late", async () => {
    const { raw, aitStorage } = sharedSdkStorage();
    let answer: (hash: string) => void = () => {};
    const guarded = createIdentityGuardedStorage(aitStorage, {
      anonymousHashStorageKey: "anonymousHash",
      appSessionStorageKey: ["appSession", "tossSession"],
      production: true,
      revalidate: true,
      resolveAnonymousHash: () => new Promise<string>((resolve) => { answer = resolve; }),
      lookupTimeoutMs: 20,
    });
    const save = guarded.setItem("appSession", "adopted-session");
    const clear = guarded.setItem("appSession", "");
    await expect(save).rejects.toThrow("timed out");
    await clear;
    expect(raw.get(`${APP_KEY}.appSession`)).toBe("");
    // The SDK answering after the timeout records nothing and saves nothing.
    answer("ait:account-a");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(raw.get(`${APP_KEY}.appSession`)).toBe("");
    expect(raw.has(`${APP_KEY}.anonymousHash`)).toBe(false);
  });

  test("a stalled account lookup on read rejects without recording or clearing", async () => {
    const { raw, rnBridge, aitStorage } = sharedSdkStorage();
    await rnBundleWroteSession(rnBridge);
    let answer: (hash: string) => void = () => {};
    const guarded = createIdentityGuardedStorage(aitStorage, {
      anonymousHashStorageKey: "anonymousHash",
      appSessionStorageKey: ["appSession", "tossSession"],
      production: true,
      revalidate: true,
      resolveAnonymousHash: () => new Promise<string>((resolve) => { answer = resolve; }),
      lookupTimeoutMs: 20,
    });
    await expect(guarded.getItem("appSession")).rejects.toThrow("timed out");
    // The SDK answering after the timeout switches nothing.
    answer("ait:account-b");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(raw.get(`${APP_KEY}.anonymousHash`)).toBe("ait:account-a");
    expect(raw.get(`${APP_KEY}.appSession`)).toBe("rn-app-session");
    expect(raw.get(`${APP_KEY}.tossSession`)).toBe("rn-toss-session");
    // Writes are not held behind the timed-out read.
    await guarded.setItem("appSession", "");
    expect(raw.get(`${APP_KEY}.appSession`)).toBe("");
  });

  test("a delayed account check cannot clear a session saved after the switch", async () => {
    const { raw, rnBridge, aitStorage } = sharedSdkStorage();
    await rnBundleWroteSession(rnBridge);
    const pending: Array<(hash: string) => void> = [];
    const { session } = webSession(aitStorage, () => new Promise<string>((resolve) => { pending.push(resolve); }));
    const first = session.storage.getItem(session.appSessionStorageKey);
    const second = session.storage.getItem(session.tossSessionStorageKey);
    while (pending.length < 2) await new Promise((resolve) => setTimeout(resolve, 0));
    pending[0]!("ait:account-b");
    expect(await first).toBeNull();
    await session.storage.setItem(session.tossSessionStorageKey, "fresh-b-session");
    pending[1]!("ait:account-b");
    expect(await second).toBe("fresh-b-session");
    expect(raw.get(`${APP_KEY}.tossSession`)).toBe("fresh-b-session");
    expect(raw.get(`${APP_KEY}.appSession`)).toBe("");
  });

  test("other keys and local development skip the account lookup", async () => {
    const { raw, aitStorage } = sharedSdkStorage();
    raw.set(`${APP_KEY}.appSession`, "dev-session");
    raw.set(`${APP_KEY}.preferences`, "dark");
    const guarded = webSession(aitStorage, async () => "ait:account-a");
    expect(await guarded.session.storage.getItem("preferences")).toBe("dark");
    expect(guarded.lookups()).toBe(0);
    const local = webSession(aitStorage, async () => { throw new Error("no SDK"); }, { production: false });
    expect(await local.session.storage.getItem(local.session.appSessionStorageKey)).toBe("dev-session");
    expect(local.lookups()).toBe(0);
  });

  test("rejects missing dependencies and colliding keys", () => {
    const { aitStorage } = sharedSdkStorage();
    expect(() => createAppsInTossWebSessionStorage({ storage: aitStorage } as never)).toThrow(TypeError);
    expect(() => createAppsInTossWebSessionStorage({
      storage: aitStorage, resolveAnonymousHash: async () => "ait:a", tossSessionStorageKey: "appSession",
    })).toThrow(/distinct/);
  });

  test("the hash format helpers stay the RN exports", () => {
    expect(rnIdentity.APPS_IN_TOSS_ANONYMOUS_HASH_PREFIX).toBe("ait:");
    expect(rnIdentity.isAppsInTossAnonymousHash("ait:x")).toBe(true);
    expect(rnIdentity.isAppsInTossAnonymousHash("ait: ")).toBe(false);
  });
});
