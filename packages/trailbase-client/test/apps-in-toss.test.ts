import { describe, expect, test } from "bun:test";
import {
  AppsInTossStorageUnavailableError,
  createAppsInTossKeyValueStorage,
  createAppsInTossSessionManager,
  createMemoryKeyValueStorage,
  normalizeAppsInTossLoginResult,
  requestAppsInTossLogin,
} from "../src/apps-in-toss";

describe("AppsInToss client adapters", () => {
  test("reexports login and session helpers from the AppsInToss subpath", () => {
    expect(typeof createAppsInTossSessionManager).toBe("function");
    expect(typeof createAppsInTossKeyValueStorage).toBe("function");
    expect(typeof normalizeAppsInTossLoginResult).toBe("function");
    expect(typeof requestAppsInTossLogin).toBe("function");
  });

  test("wraps Apps in Toss Storage as KeyValueStorage", async () => {
    const nativeStorage = new Map<string, string>();
    const storage = createAppsInTossKeyValueStorage({
      env: "production",
      storage: {
        getItem: (key) => nativeStorage.get(key) ?? null,
        setItem: (key, value) => nativeStorage.set(key, value),
      },
    });

    await storage.setItem("session", "value");
    expect(await storage.getItem("session")).toBe("value");
  });

  test("uses fallback storage only outside production", async () => {
    const fallback = createMemoryKeyValueStorage();
    const storage = createAppsInTossKeyValueStorage({
      env: "test",
      fallbackStorage: fallback,
    });

    await storage.setItem("session", "fallback");
    expect(await storage.getItem("session")).toBe("fallback");
  });

  test("fails in production when Apps in Toss Storage is unavailable", () => {
    expect(() =>
      createAppsInTossKeyValueStorage({
        env: "production",
        fallbackStorage: createMemoryKeyValueStorage(),
      }),
    ).toThrow(AppsInTossStorageUnavailableError);
  });
});
