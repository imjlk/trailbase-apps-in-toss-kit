import { describe, expect, test } from "bun:test";
import {
  createAppsInTossSessionStorage,
  createPersistentJsonAtom,
} from "../src/storage";
import { mapStorage } from "./helpers";

describe("AppsInToss RN storage helpers", () => {
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

