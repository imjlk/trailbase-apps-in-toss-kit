import { afterAll, describe, expect, mock, test } from "bun:test";
import { createAppsInTossWebAdapter } from "../src/index";

/**
 * Default-loader coverage for the web package: the adapter's default
 * `loadSdk` imports `@apps-in-toss/web-framework`; these tests replace
 * that module instead of injecting `loadSdk`, pinning the connection
 * through the real @ait-kit/sdk delegation paths. As on the RN side, the
 * mock exposes stable wrapper functions over a mutable provider record
 * because bun snapshots a mocked module's namespace at first import.
 */
type WebProvider = {
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
