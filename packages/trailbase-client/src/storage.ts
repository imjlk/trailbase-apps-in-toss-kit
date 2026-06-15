import type { KeyValueStorage } from "./index";

export interface AppsInTossStorageBridge {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): void | Promise<void>;
  removeItem?(key: string): void | Promise<void>;
  clearItems?(): void | Promise<void>;
}

export interface CreateAppsInTossKeyValueStorageOptions {
  storage?: AppsInTossStorageBridge | null;
  fallbackStorage?: KeyValueStorage | null;
  env?: string;
  allowFallback?: boolean;
  productionRequired?: boolean;
}

export interface WebStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

export class AppsInTossStorageUnavailableError extends Error {
  constructor(message = "Apps in Toss Storage is required in production.") {
    super(message);
    this.name = "AppsInTossStorageUnavailableError";
  }
}

export function createAppsInTossKeyValueStorage({
  storage,
  fallbackStorage,
  env = inferRuntimeEnv(),
  allowFallback,
  productionRequired,
}: CreateAppsInTossKeyValueStorageOptions = {}): KeyValueStorage {
  if (isAppsInTossStorageBridge(storage)) {
    return {
      getItem: (key) => storage.getItem(key),
      setItem: (key, value) => storage.setItem(key, value),
    };
  }

  const isProduction = env.trim().toLowerCase() === "production";
  const mustUseNativeStorage = productionRequired ?? isProduction;
  const canUseFallback = allowFallback ?? !isProduction;
  if (mustUseNativeStorage || !canUseFallback) {
    throw new AppsInTossStorageUnavailableError(
      "Apps in Toss Storage is required. Pass Storage from @apps-in-toss/framework or enable fallback only outside production.",
    );
  }

  return fallbackStorage ?? createDefaultFallbackStorage();
}

export function createMemoryKeyValueStorage(
  initial?: Iterable<readonly [string, string]> | Record<string, string>,
): KeyValueStorage {
  const map = new Map<string, string>(
    initial && Symbol.iterator in Object(initial)
      ? (initial as Iterable<readonly [string, string]>)
      : Object.entries(initial ?? {}),
  );
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
  };
}

export function createWebLocalStorageKeyValueStorage(
  storage: WebStorageLike | null | undefined = globalLocalStorage(),
): KeyValueStorage | null {
  if (!storage) {
    return null;
  }
  return {
    getItem: (key) => storage.getItem(key),
    setItem: (key, value) => storage.setItem(key, value),
  };
}

function createDefaultFallbackStorage(): KeyValueStorage {
  return createWebLocalStorageKeyValueStorage() ?? createMemoryKeyValueStorage();
}

function isAppsInTossStorageBridge(value: unknown): value is AppsInTossStorageBridge {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof (value as AppsInTossStorageBridge).getItem === "function" &&
      typeof (value as AppsInTossStorageBridge).setItem === "function",
  );
}

function globalLocalStorage(): WebStorageLike | null {
  const candidate = (globalThis as typeof globalThis & { localStorage?: WebStorageLike }).localStorage;
  if (!candidate || typeof candidate.getItem !== "function" || typeof candidate.setItem !== "function") {
    return null;
  }
  return candidate;
}

function inferRuntimeEnv(): string {
  const processLike = (globalThis as typeof globalThis & {
    process?: { env?: Record<string, string | undefined> };
  }).process;
  return processLike?.env?.APP_ENV ?? processLike?.env?.NODE_ENV ?? "";
}
