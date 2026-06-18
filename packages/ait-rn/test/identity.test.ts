import { describe, expect, test } from "bun:test";
import { createAppsInTossSessionManager } from "@trailbase-apps-in-toss-kit/trailbase-client";
import {
  AppsInTossIdentityError,
  createAppsInTossIdentityStorage,
  isAppsInTossAnonymousHash,
  resolveAppsInTossAnonymousHash,
} from "../src/identity";
import { mapStorage, restoreEnv } from "./helpers";

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

  test("rejects malformed pre-prefixed anonymous hashes in production", async () => {
    await expect(
      resolveAppsInTossAnonymousHash({
        getAnonymousKey: async () => ({ type: "HASH", hash: " ait: " }),
        production: true,
      }),
    ).rejects.toMatchObject({
      code: "ANONYMOUS_KEY_INVALID_RESPONSE",
    });
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

    await expect(
      identityStorage.getItem("poll-maker.anonymousHash"),
    ).resolves.toBe("ait:existing");
    expect(storage.map.get("poll-maker.anonymousHash")).toBe("ait:existing");
  });

  test("replaces legacy random anonymous hashes in production", async () => {
    const storage = mapStorage([["poll-maker.anonymousHash", "anon_legacy"]]);
    const identityStorage = createAppsInTossIdentityStorage(storage, {
      anonymousHashStorageKey: "poll-maker.anonymousHash",
      getAnonymousKey: async () => ({ type: "HASH", hash: "user-key" }),
      production: true,
    });

    await expect(
      identityStorage.getItem("poll-maker.anonymousHash"),
    ).resolves.toBe("ait:user-key");
    expect(storage.map.get("poll-maker.anonymousHash")).toBe("ait:user-key");
  });

  test("preserves legacy random anonymous hashes outside production", async () => {
    const storage = mapStorage([["poll-maker.anonymousHash", "anon_legacy"]]);
    const identityStorage = createAppsInTossIdentityStorage(storage, {
      anonymousHashStorageKey: "poll-maker.anonymousHash",
      getAnonymousKey: async () => ({ type: "HASH", hash: "user-key" }),
      production: false,
    });

    await expect(
      identityStorage.getItem("poll-maker.anonymousHash"),
    ).resolves.toBe("anon_legacy");
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
});
