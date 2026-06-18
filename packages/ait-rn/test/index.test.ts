import { describe, expect, test } from "bun:test";
import { createAppsInTossSessionManager } from "@trailbase-apps-in-toss-kit/trailbase-client";
import {
  AppsInTossRnIdentityError,
  createAppsInTossRnIdentityStorage,
  isAppsInTossRnAnonymousHash,
  resolveAppsInTossRnAnonymousHash,
} from "../src/index";

describe("AppsInToss RN identity helpers", () => {
  test("resolves valid getAnonymousKey HASH responses", async () => {
    await expect(
      resolveAppsInTossRnAnonymousHash({
        getAnonymousKey: async () => ({ type: "HASH", hash: " user-key " }),
        production: true,
      }),
    ).resolves.toBe("ait:user-key");
  });

  test("rejects unsupported anonymous keys in production", async () => {
    await expect(
      resolveAppsInTossRnAnonymousHash({
        getAnonymousKey: async () => undefined,
        production: true,
      }),
    ).rejects.toMatchObject({
      code: "ANONYMOUS_KEY_UNSUPPORTED",
      name: "AppsInTossRnIdentityError",
    });
  });

  test("rejects Apps in Toss SDK ERROR responses in production", async () => {
    await expect(
      resolveAppsInTossRnAnonymousHash({
        getAnonymousKey: async () => "ERROR",
        production: true,
      }),
    ).rejects.toMatchObject({
      code: "ANONYMOUS_KEY_ERROR",
    });
  });

  test("rejects invalid category responses in production", async () => {
    await expect(
      resolveAppsInTossRnAnonymousHash({
        getAnonymousKey: async () => "INVALID_CATEGORY",
        production: true,
      }),
    ).rejects.toMatchObject({
      code: "ANONYMOUS_KEY_INVALID_CATEGORY",
    });
  });

  test("rejects invalid response shapes in production", async () => {
    await expect(
      resolveAppsInTossRnAnonymousHash({
        getAnonymousKey: async () => ({ type: "HASH", hash: " " }),
        production: true,
      }),
    ).rejects.toBeInstanceOf(AppsInTossRnIdentityError);
  });

  test("wraps SDK throws in production", async () => {
    await expect(
      resolveAppsInTossRnAnonymousHash({
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
      resolveAppsInTossRnAnonymousHash({
        createDevFallback: () => "dev-anon_test",
        getAnonymousKey: async () => "ERROR",
        production: false,
      }),
    ).resolves.toBe("dev-anon_test");
  });

  test("detects Apps in Toss RN anonymous hashes", () => {
    expect(isAppsInTossRnAnonymousHash("ait:user-key")).toBe(true);
    expect(isAppsInTossRnAnonymousHash("ait: ")).toBe(false);
    expect(isAppsInTossRnAnonymousHash("anon_legacy")).toBe(false);
  });

  test("preserves existing Apps in Toss hashes in storage", async () => {
    const storage = mapStorage([["poll-maker.anonymousHash", "ait:existing"]]);
    const identityStorage = createAppsInTossRnIdentityStorage(storage, {
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
    const identityStorage = createAppsInTossRnIdentityStorage(storage, {
      anonymousHashStorageKey: "poll-maker.anonymousHash",
      getAnonymousKey: async () => ({ type: "HASH", hash: "user-key" }),
      production: true,
    });

    await expect(identityStorage.getItem("poll-maker.anonymousHash")).resolves.toBe(
      "ait:user-key",
    );
    expect(storage.map.get("poll-maker.anonymousHash")).toBe("ait:user-key");
  });

  test("delegates non-anonymous storage keys", async () => {
    const storage = mapStorage([["poll-maker.appSession", "session"]]);
    const identityStorage = createAppsInTossRnIdentityStorage(storage, {
      anonymousHashStorageKey: "poll-maker.anonymousHash",
      production: true,
    });

    await expect(identityStorage.getItem("poll-maker.appSession")).resolves.toBe(
      "session",
    );
  });

  test("integrates with the TrailBase session manager bootstrap body", async () => {
    const storage = createAppsInTossRnIdentityStorage(mapStorage(), {
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
});

function mapStorage(entries: Array<[string, string]> = []) {
  const map = new Map<string, string>(entries);
  return {
    getItem: (key: string) => map.get(key) ?? null,
    map,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
  };
}
