import { describe, expect, test } from "bun:test";
import { createAppsInTossSessionManager } from "@trailbase-apps-in-toss-kit/trailbase-client";
import {
  AppsInTossIdentityError,
  createAppsInTossLoginBridge,
  createAppsInTossIdentityStorage,
  createAppsInTossSessionStorage,
  createPersistentJsonAtom,
  ensureAppsInTossHapticFallback,
  isAppsInTossAnonymousHash,
  resolveAppsInTossAnonymousHash,
} from "../src/index";

describe("AppsInToss RN identity helpers", () => {
  test("resolves valid getAnonymousKey HASH responses", async () => {
    await expect(
      resolveAppsInTossAnonymousHash({
        getAnonymousKey: async () => ({ type: "HASH", hash: " user-key " }),
        production: true,
      }),
    ).resolves.toBe("ait:user-key");
  });

  test("preserves already-prefixed getAnonymousKey HASH responses", async () => {
    await expect(
      resolveAppsInTossAnonymousHash({
        getAnonymousKey: async () => ({ type: "HASH", hash: " ait:user-key " }),
        production: true,
      }),
    ).resolves.toBe("ait:user-key");
  });

  test("rejects unsupported anonymous keys in production", async () => {
    await expect(
      resolveAppsInTossAnonymousHash({
        getAnonymousKey: async () => undefined,
        production: true,
      }),
    ).rejects.toMatchObject({
      code: "ANONYMOUS_KEY_UNSUPPORTED",
      name: "AppsInTossIdentityError",
    });
  });

  test("rejects Apps in Toss SDK ERROR responses in production", async () => {
    await expect(
      resolveAppsInTossAnonymousHash({
        getAnonymousKey: async () => "ERROR",
        production: true,
      }),
    ).rejects.toMatchObject({
      code: "ANONYMOUS_KEY_ERROR",
    });
  });

  test("rejects invalid category responses in production", async () => {
    await expect(
      resolveAppsInTossAnonymousHash({
        getAnonymousKey: async () => "INVALID_CATEGORY",
        production: true,
      }),
    ).rejects.toMatchObject({
      code: "ANONYMOUS_KEY_INVALID_CATEGORY",
    });
  });

  test("rejects invalid response shapes in production", async () => {
    await expect(
      resolveAppsInTossAnonymousHash({
        getAnonymousKey: async () => ({ type: "HASH", hash: " " }),
        production: true,
      }),
    ).rejects.toBeInstanceOf(AppsInTossIdentityError);
  });

  test("wraps SDK throws in production", async () => {
    await expect(
      resolveAppsInTossAnonymousHash({
        getAnonymousKey: async () => {
          throw new Error("bridge failed");
        },
        production: true,
      }),
    ).rejects.toMatchObject({
      code: "ANONYMOUS_KEY_THROWN",
    });
  });

  test("falls back to dev anonymous hashes outside production", async () => {
    await expect(
      resolveAppsInTossAnonymousHash({
        createDevFallback: () => "dev-anon_test",
        getAnonymousKey: async () => "ERROR",
        production: false,
      }),
    ).resolves.toBe("dev-anon_test");
  });

  test("detects production env values case-insensitively", async () => {
    const previous = process.env.APP_ENV;
    process.env.APP_ENV = " PRODUCTION ";

    try {
      await expect(
        resolveAppsInTossAnonymousHash({
          getAnonymousKey: async () => "ERROR",
        }),
      ).rejects.toMatchObject({
        code: "ANONYMOUS_KEY_ERROR",
      });
    } finally {
      restoreEnv("APP_ENV", previous);
    }
  });

  test("detects Apps in Toss RN anonymous hashes", () => {
    expect(isAppsInTossAnonymousHash("ait:user-key")).toBe(true);
    expect(isAppsInTossAnonymousHash("ait: ")).toBe(false);
    expect(isAppsInTossAnonymousHash("anon_legacy")).toBe(false);
  });

  test("preserves existing Apps in Toss hashes in storage", async () => {
    const storage = mapStorage([["poll-maker.anonymousHash", "ait:existing"]]);
    const identityStorage = createAppsInTossIdentityStorage(storage, {
      anonymousHashStorageKey: "poll-maker.anonymousHash",
      getAnonymousKey: async () => ({ type: "HASH", hash: "new-key" }),
      production: true,
    });

    await expect(identityStorage.getItem("poll-maker.anonymousHash")).resolves.toBe(
      "ait:existing",
    );
    expect(storage.map.get("poll-maker.anonymousHash")).toBe("ait:existing");
  });

  test("replaces legacy random anonymous hashes in production", async () => {
    const storage = mapStorage([["poll-maker.anonymousHash", "anon_legacy"]]);
    const identityStorage = createAppsInTossIdentityStorage(storage, {
      anonymousHashStorageKey: "poll-maker.anonymousHash",
      getAnonymousKey: async () => ({ type: "HASH", hash: "user-key" }),
      production: true,
    });

    await expect(identityStorage.getItem("poll-maker.anonymousHash")).resolves.toBe(
      "ait:user-key",
    );
    expect(storage.map.get("poll-maker.anonymousHash")).toBe("ait:user-key");
  });

  test("preserves legacy random anonymous hashes outside production", async () => {
    const storage = mapStorage([["poll-maker.anonymousHash", "anon_legacy"]]);
    const identityStorage = createAppsInTossIdentityStorage(storage, {
      anonymousHashStorageKey: "poll-maker.anonymousHash",
      getAnonymousKey: async () => ({ type: "HASH", hash: "user-key" }),
      production: false,
    });

    await expect(identityStorage.getItem("poll-maker.anonymousHash")).resolves.toBe(
      "anon_legacy",
    );
    expect(storage.map.get("poll-maker.anonymousHash")).toBe("anon_legacy");
  });

  test("invalidates stored app sessions when production refreshes a legacy hash", async () => {
    const storage = mapStorage([
      ["poll-maker.anonymousHash", "anon_legacy"],
      ["poll-maker.appSession", "session"],
    ]);
    const identityStorage = createAppsInTossIdentityStorage(storage, {
      anonymousHashStorageKey: "poll-maker.anonymousHash",
      appSessionStorageKey: "poll-maker.appSession",
      getAnonymousKey: async () => ({ type: "HASH", hash: "user-key" }),
      production: true,
    });

    await expect(identityStorage.getItem("poll-maker.appSession")).resolves.toBeNull();
    expect(storage.map.get("poll-maker.anonymousHash")).toBe("ait:user-key");
    expect(storage.map.get("poll-maker.appSession")).toBe("session");
  });

  test("delegates non-anonymous storage keys", async () => {
    const storage = mapStorage([["poll-maker.appSession", "session"]]);
    const identityStorage = createAppsInTossIdentityStorage(storage, {
      anonymousHashStorageKey: "poll-maker.anonymousHash",
      production: true,
    });

    await expect(identityStorage.getItem("poll-maker.appSession")).resolves.toBe(
      "session",
    );
  });

  test("integrates with the TrailBase session manager bootstrap body", async () => {
    const storage = createAppsInTossIdentityStorage(mapStorage(), {
      anonymousHashStorageKey: "poll-maker.anonymousHash",
      getAnonymousKey: async () => ({ type: "HASH", hash: "user-key" }),
      production: true,
    });
    let bootstrapAnonymousHash = "";
    const manager = createAppsInTossSessionManager({
      storage,
      anonymousHashStorageKey: "poll-maker.anonymousHash",
      appLogin: async () => ({ authorizationCode: "code", referrer: "DEFAULT" }),
      bootstrap: async (anonymousHash) => {
        bootstrapAnonymousHash = anonymousHash;
        return { sessionToken: "anonymous-session", user: { id: "user-1" } };
      },
      completeTossLogin: async () => ({
        sessionToken: "toss-session",
        user: { id: "user-1" },
      }),
      loadSession: async ({ sessionToken }) => ({
        sessionToken,
        user: { id: "user-1" },
      }),
    });

    await manager.getOrCreateAppSession();

    expect(bootstrapAnonymousHash).toBe("ait:user-key");
  });

  test("migrates legacy hashes before restoring stored app sessions", async () => {
    const storage = createAppsInTossIdentityStorage(
      mapStorage([
        ["poll-maker.anonymousHash", "anon_legacy"],
        [
          "poll-maker.appSession",
          JSON.stringify({
            authProvider: "anonymous",
            sessionToken: "legacy-session",
            user: { id: "legacy" },
          }),
        ],
      ]),
      {
        anonymousHashStorageKey: "poll-maker.anonymousHash",
        appSessionStorageKey: "poll-maker.appSession",
        getAnonymousKey: async () => ({ type: "HASH", hash: "user-key" }),
        production: true,
      },
    );
    let bootstrapAnonymousHash = "";
    let loadSessionCalls = 0;
    const manager = createAppsInTossSessionManager({
      storage,
      anonymousHashStorageKey: "poll-maker.anonymousHash",
      appSessionStorageKey: "poll-maker.appSession",
      appLogin: async () => ({ authorizationCode: "code", referrer: "DEFAULT" }),
      bootstrap: async (anonymousHash) => {
        bootstrapAnonymousHash = anonymousHash;
        return { sessionToken: "anonymous-session", user: { id: "user-1" } };
      },
      completeTossLogin: async () => ({
        sessionToken: "toss-session",
        user: { id: "user-1" },
      }),
      loadSession: async ({ sessionToken }) => {
        loadSessionCalls += 1;
        return { sessionToken, user: { id: "legacy" } };
      },
    });

    await expect(manager.getOrCreateAppSession()).resolves.toMatchObject({
      authProvider: "anonymous",
      sessionToken: "anonymous-session",
    });

    expect(loadSessionCalls).toBe(0);
    expect(bootstrapAnonymousHash).toBe("ait:user-key");
  });

  test("creates app-scoped session storage and invalidates legacy sessions", async () => {
    const storage = mapStorage([
      ["poll-maker.anonymousHash", "anon_legacy"],
      ["poll-maker.appSession", "session"],
    ]);
    const sessionStorage = createAppsInTossSessionStorage({
      appKey: "poll-maker",
      env: "production",
      getAnonymousKey: async () => ({ type: "HASH", hash: "user-key" }),
      storage,
    });

    expect(sessionStorage.anonymousHashStorageKey).toBe(
      "poll-maker.anonymousHash",
    );
    expect(sessionStorage.appSessionStorageKey).toBe("poll-maker.appSession");
    expect(sessionStorage.tossSessionStorageKey).toBe("poll-maker.tossSession");
    await expect(
      sessionStorage.storage.getItem("poll-maker.appSession"),
    ).resolves.toBeNull();
    expect(storage.map.get("poll-maker.anonymousHash")).toBe("ait:user-key");
  });

  test("requires native Apps in Toss storage in production session storage", () => {
    expect(() =>
      createAppsInTossSessionStorage({
        appKey: "poll-maker",
        env: "production",
      }),
    ).toThrow("Apps in Toss Storage is required");
    expect(() =>
      createAppsInTossSessionStorage({
        appKey: "poll-maker",
        env: "development",
        fallbackStorage: mapStorage(),
        production: true,
      }),
    ).toThrow("Apps in Toss Storage is required");
  });

  test("allows fallback session storage outside production", async () => {
    const sessionStorage = createAppsInTossSessionStorage({
      appKey: "poll-maker",
      createDevFallback: () => "dev-anon_local",
      env: "development",
    });

    await expect(
      sessionStorage.storage.getItem("poll-maker.anonymousHash"),
    ).resolves.toBe("dev-anon_local");
  });

  test("fails closed when production appLogin is unavailable", async () => {
    const bridge = createAppsInTossLoginBridge({ production: true });

    await expect(bridge.appLogin()).rejects.toMatchObject({
      code: "APP_LOGIN_UNAVAILABLE",
      name: "AppsInTossLoginBridgeError",
    });
  });

  test("wraps production appLogin throws", async () => {
    const bridge = createAppsInTossLoginBridge({
      appLogin: async () => {
        throw new Error("bridge failed");
      },
      production: true,
    });

    await expect(bridge.appLogin()).rejects.toMatchObject({
      code: "APP_LOGIN_THROWN",
    });
  });

  test("returns explicit dev appLogin fallbacks outside production", async () => {
    const bridge = createAppsInTossLoginBridge({
      createDevFallback: () => ({
        authorizationCode: "dev-auth-code",
        referrer: "SANDBOX",
      }),
      production: false,
    });

    await expect(bridge.appLogin()).resolves.toEqual({
      authorizationCode: "dev-auth-code",
      referrer: "SANDBOX",
    });
  });

  test("normalizes login integration check failures by runtime", async () => {
    const devBridge = createAppsInTossLoginBridge({
      getIsTossLoginIntegratedService: async () => {
        throw new Error("not configured");
      },
      production: false,
    });
    const prodBridge = createAppsInTossLoginBridge({
      getIsTossLoginIntegratedService: async () => {
        throw new Error("not configured");
      },
      production: true,
    });
    const disabledBridge = createAppsInTossLoginBridge({
      getIsTossLoginIntegratedService: async () => false,
      production: true,
    });

    await expect(
      devBridge.getIsTossLoginIntegratedService(),
    ).resolves.toBeUndefined();
    await expect(
      prodBridge.getIsTossLoginIntegratedService(),
    ).rejects.toMatchObject({
      code: "TOSS_LOGIN_INTEGRATION_CHECK_THROWN",
    });
    await expect(
      disabledBridge.getIsTossLoginIntegratedService(),
    ).resolves.toBeUndefined();
  });

  test("installs haptic fallbacks only when native modules need one", async () => {
    const generateHapticFeedback = () => undefined;
    const nativeModules = {
      GraniteModule: { generateHapticFeedback },
    };
    expect(ensureAppsInTossHapticFallback({ nativeModules })).toBe(true);
    expect(nativeModules.GraniteModule.generateHapticFeedback).toBe(
      generateHapticFeedback,
    );

    const missingNativeModules: {
      GraniteModule?: {
        generateHapticFeedback?: (
          options: { type: string },
        ) => void | Promise<void>;
      };
    } = {};
    expect(
      ensureAppsInTossHapticFallback({ nativeModules: missingNativeModules }),
    ).toBe(true);
    const installedHapticFallback =
      missingNativeModules.GraniteModule?.generateHapticFeedback;
    expect(typeof installedHapticFallback).toBe("function");
    if (!installedHapticFallback) {
      throw new Error("Expected haptic fallback to be installed.");
    }
    await expect(
      Promise.resolve(installedHapticFallback({ type: "tap" })),
    ).resolves.toBeUndefined();

    const legacyNativeModules: {
      BedrockModule: {
        appVersion: string;
        generateHapticFeedback?: (
          options: { type: string },
        ) => void | Promise<void>;
      };
      GraniteModule?: {
        appVersion?: string;
        generateHapticFeedback?: (
          options: { type: string },
        ) => void | Promise<void>;
      };
    } = { BedrockModule: { appVersion: "legacy" } };
    expect(
      ensureAppsInTossHapticFallback({
        nativeModules: legacyNativeModules,
      }),
    ).toBe(true);
    expect(typeof legacyNativeModules.BedrockModule.generateHapticFeedback).toBe(
      "function",
    );
    expect(typeof legacyNativeModules.GraniteModule?.generateHapticFeedback).toBe(
      "function",
    );
    expect(
      ensureAppsInTossHapticFallback({ nativeModules: Object.freeze({}) }),
    ).toBe(false);
  });

  test("reads, writes, and clears persistent JSON atoms", async () => {
    const storage = mapStorage([
      ["settings", JSON.stringify({ enabled: true })],
      ["invalid", "not-json"],
    ]);
    const settingsAtom = createPersistentJsonAtom<{ enabled: boolean }>({
      fallback: { enabled: false },
      key: "settings",
      normalize: (value) =>
        value &&
        typeof value === "object" &&
        typeof (value as { enabled?: unknown }).enabled === "boolean"
          ? { enabled: (value as { enabled: boolean }).enabled }
          : null,
      storage,
    });
    const invalidAtom = createPersistentJsonAtom({
      fallback: () => ({ enabled: false }),
      key: "invalid",
      normalize: () => null,
      storage,
    });
    const countAtom = createPersistentJsonAtom<number>({
      fallback: 0,
      key: "count",
      storage,
    });

    await expect(settingsAtom.read()).resolves.toEqual({ enabled: true });
    await expect(invalidAtom.read()).resolves.toEqual({ enabled: false });
    expect(storage.map.has("invalid")).toBe(false);
    await countAtom.write(3);
    expect(storage.map.get("count")).toBe("3");
    await expect(countAtom.read()).resolves.toBe(3);
    await countAtom.clear();
    expect(storage.map.has("count")).toBe(false);
  });

  test("falls back when persistent JSON storage fails", async () => {
    const atom = createPersistentJsonAtom<number>({
      fallback: 7,
      key: "count",
      storage: {
        getItem: () => {
          throw new Error("read failed");
        },
        removeItem: () => {
          throw new Error("remove failed");
        },
        setItem: () => {
          throw new Error("write failed");
        },
      },
    });

    await expect(atom.read()).resolves.toBe(7);
    await expect(atom.write(8)).resolves.toBeUndefined();
    await expect(atom.clear()).resolves.toBeUndefined();
  });
});

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}

function mapStorage(entries: Array<[string, string]> = []) {
  const map = new Map<string, string>(entries);
  return {
    getItem: (key: string) => map.get(key) ?? null,
    map,
    removeItem: (key: string) => {
      map.delete(key);
    },
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
  };
}
