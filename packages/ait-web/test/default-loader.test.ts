import { afterAll, describe, expect, mock, test } from "bun:test";
import { createAppsInTossWebAdapter, createAppsInTossFullScreenAdBridge, createAppsInTossSdkStorageBridge } from "../src/index";

/**
 * Default-loader coverage for the web package: the adapter's default
 * `loadSdk` imports `@apps-in-toss/web-framework`; these tests replace
 * that module instead of injecting `loadSdk`, pinning the connection
 * through the real @ait-kit/sdk delegation paths. As on the RN side, the
 * mock exposes stable wrapper functions over a mutable provider record
 * because bun snapshots a mocked module's namespace at first import.
 */
type WebProvider = {
  ads?: { loads: number; shows: number; cleanups: number };
  login?: () => Promise<unknown>;
  getAnonymousKey?: () => Promise<unknown>;
  getAnonymousKeySupported?: boolean;
  storage?: {
    getItem?: (key: string) => Promise<string | null>;
    setItem?: (key: string, value: string) => Promise<void>;
    removeItem?: (key: string) => Promise<void>;
  };
  createLink?: (input: { path: string; ogImageUrl?: string }) => Promise<string>;
  sendMessage?: (input: { message: string }) => Promise<void>;
};

const provider: { current: WebProvider } = { current: {} };

// The mock.module replacement lives for the whole test process; clearing the
// provider afterwards makes any later accidental default-path use fail
// loudly instead of silently serving this file's leftovers.
afterAll(() => {
  provider.current = {};
});

function withMutableSupport<T extends (...args: never[]) => unknown>(
  read: () => T | undefined,
  supported: () => boolean,
) {
  return Object.assign((...args: Parameters<T>) => read()!(...args), {
    isSupported: supported,
  }) as T & { isSupported?: () => boolean };
}

mock.module("@apps-in-toss/web-framework", () => ({
  loadFullScreenAd: Object.assign(({ onEvent }) => {
    provider.current.ads!.loads++;
    onEvent({ type: "loaded" });
    return () => { provider.current.ads!.cleanups++; };
  }, { isSupported: () => Boolean(provider.current.ads) }),
  showFullScreenAd: Object.assign(({ onEvent }) => {
    provider.current.ads!.shows++;
    onEvent({ type: "show" });
    onEvent({ type: "userEarnedReward", data: { unitType: "chance", unitAmount: 1 } });
    onEvent({ type: "dismissed" });
    return () => { provider.current.ads!.cleanups++; };
  }, { isSupported: () => Boolean(provider.current.ads) }),
  TossAuth: {
    login: (...args: Parameters<NonNullable<WebProvider["login"]>>) =>
      provider.current.login!(...args),
  },
  User: {
    getAnonymousKey: withMutableSupport(
      () => provider.current.getAnonymousKey,
      () => provider.current.getAnonymousKeySupported !== false,
    ),
  },
  Storage: {
    getItem: (...args: Parameters<NonNullable<NonNullable<WebProvider["storage"]>["getItem"]>>) =>
      provider.current.storage!.getItem!(...args),
    setItem: (...args: Parameters<NonNullable<NonNullable<WebProvider["storage"]>["setItem"]>>) =>
      provider.current.storage!.setItem!(...args),
    removeItem: (...args: Parameters<NonNullable<NonNullable<WebProvider["storage"]>["removeItem"]>>) =>
      provider.current.storage!.removeItem!(...args),
  },
  Share: {
    createLink: (...args: Parameters<NonNullable<WebProvider["createLink"]>>) =>
      provider.current.createLink!(...args),
    sendMessage: (...args: Parameters<NonNullable<WebProvider["sendMessage"]>>) =>
      provider.current.sendMessage!(...args),
  },
}));

describe("web default loader connections through @ait-kit/sdk", () => {
  test("anonymousHash delegates to the official User.getAnonymousKey", async () => {
    provider.current = {
      getAnonymousKey: async () => ({ type: "HASH", hash: "web-hash" }),
    };
    const adapter = createAppsInTossWebAdapter({ appKey: "sample" });
    await expect(adapter.anonymousHash()).resolves.toBe("ait:web-hash");
  });

  test("storage operations run through the sdk storage adapter with app namespacing", async () => {
    const values = new Map<string, string>([["sample.session", "existing"]]);
    const seenKeys: string[] = [];
    provider.current = {
      storage: {
        getItem: async (key) => {
          seenKeys.push(`get:${key}`);
          return values.get(key) ?? null;
        },
        setItem: async (key, value) => {
          seenKeys.push(`set:${key}`);
          values.set(key, value);
        },
        removeItem: async (key) => {
          seenKeys.push(`remove:${key}`);
          values.delete(key);
        },
      },
    };
    const adapter = createAppsInTossWebAdapter({ appKey: "sample" });
    expect(await adapter.storage.getItem("session")).toBe("existing");
    await adapter.storage.setItem("session", "next");
    expect(values.get("sample.session")).toBe("next");
    await adapter.storage.removeItem("session");
    expect(await adapter.storage.getItem("session")).toBeNull();
    expect(seenKeys).toEqual([
      "get:sample.session",
      "set:sample.session",
      "remove:sample.session",
      "get:sample.session",
    ]);

    // Storage failures must propagate as typed adapter errors, not silently
    // succeed or fabricate values.
    provider.current.storage.setItem = async () => {
      throw new Error("quota exceeded");
    };
    await expect(adapter.storage.setItem("session", "x")).rejects.toMatchObject({
      code: "SDK_ERROR",
      operation: "storage.set",
    });
  });

  test("share link creation delegates path validation and link pass-through", async () => {
    const linkCalls: Array<{ path: string; ogImageUrl?: string }> = [];
    provider.current = {
      createLink: async ({ path, ogImageUrl }) => {
        linkCalls.push({ path, ogImageUrl });
        return `https://link.example/${path}`;
      },
    };
    const adapter = createAppsInTossWebAdapter({ appKey: "sample" });
    await expect(
      adapter.createShareLink("intoss://item/42"),
    ).resolves.toBe("https://link.example/intoss://item/42");
    expect(linkCalls).toEqual([{ path: "intoss://item/42" }]);

    // Local INVALID_INPUT checks stay ahead of the delegated call.
    await expect(adapter.createShareLink("https://not-intoss")).rejects.toMatchObject({
      code: "INVALID_INPUT",
      operation: "share path",
    });
    expect(linkCalls).toHaveLength(1);
  });

  test("share sheet completion resolves without granting reward semantics, failures reject", async () => {
    const messages: string[] = [];
    provider.current = {
      sendMessage: async ({ message }) => {
        messages.push(message);
      },
    };
    const adapter = createAppsInTossWebAdapter({ appKey: "sample" });
    await expect(adapter.share("look at this")).resolves.toBeUndefined();
    expect(messages).toEqual(["look at this"]);

    provider.current.sendMessage = async () => {
      throw new Error("sheet dismissed with error");
    };
    await expect(adapter.share("try again")).rejects.toMatchObject({
      code: "SDK_ERROR",
      operation: "share",
    });
  });

  test("login keeps the pinned local contract through the default loader", async () => {
    provider.current = {
      login: async () => ({
        authorizationCode: "one-time-code",
        referrer: "SANDBOX",
      }),
    };
    const adapter = createAppsInTossWebAdapter({ appKey: "sample" });
    await expect(adapter.login()).resolves.toEqual({
      authorizationCode: "one-time-code",
      referrer: "SANDBOX",
    });
  });
});

test("web full-screen ad default loader uses only the official web module", async () => {
  const ads = { loads: 0, shows: 0, cleanups: 0 };
  provider.current = { ads };
  const bridge = createAppsInTossFullScreenAdBridge();
  expect(ads.loads).toBe(0);
  const result = await bridge.preloadAndShow({ adGroupId: "fixture-rewarded", adFormat: "rewarded", preloadNext: false });
  expect(result).toMatchObject({ earned: true, events: ["show", "userEarnedReward", "dismissed"] });
  expect(ads).toEqual({ loads: 1, shows: 1, cleanups: 2 });
  provider.current = {};
  await expect(bridge.show({ adGroupId: "fixture-rewarded", adFormat: "rewarded" })).rejects.toMatchObject({ code: "AD_SHOW_UNSUPPORTED" });
});

test("web raw Storage bridge preserves existing fully qualified native keys", async () => {
  const key = "fixture-app.adSkips.v1.fixture-user";
  const values = new Map([[key, "existing-ticket-state"]]);
  provider.current = { storage: {
    getItem: async k => values.get(k) ?? null,
    setItem: async (k, value) => { values.set(k, value); },
    removeItem: async k => { values.delete(k); },
  } };
  const storage = createAppsInTossSdkStorageBridge();
  expect(await storage.getItem!(key)).toBe("existing-ticket-state");
  await storage.setItem!(key, "updated");
  expect([...values]).toEqual([[key, "updated"]]);
  await storage.removeItem!(key);
  expect(values.size).toBe(0);
});
