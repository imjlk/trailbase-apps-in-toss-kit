import { describe, expect, test } from "bun:test";
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
    const { session } = webSession(aitStorage, async () => "ait:account-a");
    expect(await session.storage.getItem(session.appSessionStorageKey)).toBeNull();
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
