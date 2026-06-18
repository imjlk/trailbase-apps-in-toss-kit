import {
  createAppsInTossKeyValueStorage,
  createAnonymousHash,
  type AppsInTossStorageBridge,
  type CreateAppsInTossKeyValueStorageOptions,
  type KeyValueStorage,
} from "@trailbase-apps-in-toss-kit/trailbase-client";

export const APPS_IN_TOSS_ANONYMOUS_HASH_PREFIX = "ait:";
export const DEFAULT_APPS_IN_TOSS_ANONYMOUS_HASH_STORAGE_KEY =
  "trailbase.anonymousHash";
export const DEFAULT_APPS_IN_TOSS_APP_SESSION_STORAGE_KEY =
  "trailbase.appSession";

export type AppsInTossAnonymousKeyResult =
  | { type: "HASH"; hash: string }
  | "ERROR"
  | "INVALID_CATEGORY"
  | undefined;

export type AppsInTossGetAnonymousKey = () => Promise<unknown>;
export type AppsInTossAppLogin = () => Promise<unknown>;
export type AppsInTossGetIsTossLoginIntegratedService = () => Promise<unknown>;

type AppsInTossFrameworkModule = {
  appLogin?: AppsInTossAppLogin;
  getAnonymousKey?: AppsInTossGetAnonymousKey;
  getIsTossLoginIntegratedService?: AppsInTossGetIsTossLoginIntegratedService;
};

export type AppsInTossIdentityErrorCode =
  | "ANONYMOUS_KEY_ERROR"
  | "ANONYMOUS_KEY_INVALID_CATEGORY"
  | "ANONYMOUS_KEY_INVALID_RESPONSE"
  | "ANONYMOUS_KEY_THROWN"
  | "ANONYMOUS_KEY_UNSUPPORTED";

export interface AppsInTossIdentityErrorOptions {
  cause?: unknown;
  code: AppsInTossIdentityErrorCode;
  message: string;
}

export class AppsInTossIdentityError extends Error {
  code: AppsInTossIdentityErrorCode;
  override cause?: unknown;

  constructor({ cause, code, message }: AppsInTossIdentityErrorOptions) {
    super(message);
    this.name = "AppsInTossIdentityError";
    this.code = code;
    this.cause = cause;
  }
}

export type AppsInTossLoginBridgeErrorCode =
  | "APP_LOGIN_UNAVAILABLE"
  | "APP_LOGIN_THROWN"
  | "TOSS_LOGIN_INTEGRATION_CHECK_THROWN";

export interface AppsInTossLoginBridgeErrorOptions {
  cause?: unknown;
  code: AppsInTossLoginBridgeErrorCode;
  message: string;
}

export class AppsInTossLoginBridgeError extends Error {
  code: AppsInTossLoginBridgeErrorCode;
  override cause?: unknown;

  constructor({ cause, code, message }: AppsInTossLoginBridgeErrorOptions) {
    super(message);
    this.name = "AppsInTossLoginBridgeError";
    this.code = code;
    this.cause = cause;
  }
}

export interface ResolveAppsInTossAnonymousHashOptions {
  createDevFallback?: () => string;
  getAnonymousKey?: AppsInTossGetAnonymousKey;
  production?: boolean;
}

export interface CreateAppsInTossIdentityStorageOptions
  extends ResolveAppsInTossAnonymousHashOptions {
  anonymousHashStorageKey?: string;
  appSessionStorageKey?: string | readonly string[];
}

export interface CreateAppsInTossSessionStorageOptions
  extends ResolveAppsInTossAnonymousHashOptions,
    Pick<
      CreateAppsInTossKeyValueStorageOptions,
      "allowFallback" | "fallbackStorage" | "productionRequired"
    > {
  appKey: string;
  env?: string;
  storage?: AppsInTossStorageBridge | null;
}

export interface AppsInTossSessionStorage {
  anonymousHashStorageKey: string;
  appSessionStorageKey: string;
  storage: KeyValueStorage;
  tossSessionStorageKey: string;
}

export interface CreateAppsInTossLoginBridgeOptions {
  appLogin?: AppsInTossAppLogin;
  createDevFallback?: () => unknown | Promise<unknown>;
  env?: string;
  getIsTossLoginIntegratedService?: AppsInTossGetIsTossLoginIntegratedService;
  production?: boolean;
}

export interface AppsInTossLoginBridge {
  appLogin: AppsInTossAppLogin;
  getIsTossLoginIntegratedService: AppsInTossGetIsTossLoginIntegratedService;
}

export interface AppsInTossHapticFeedbackOptions {
  type: string;
}

export interface AppsInTossHapticNativeModule {
  generateHapticFeedback?: (
    options: AppsInTossHapticFeedbackOptions,
  ) => void | Promise<void>;
  [key: string]: unknown;
}

export interface AppsInTossNativeModulesWithHaptics {
  BedrockModule?: AppsInTossHapticNativeModule | null;
  GraniteModule?: AppsInTossHapticNativeModule | null;
}

export interface EnsureAppsInTossHapticFallbackOptions {
  nativeModules?: AppsInTossNativeModulesWithHaptics | null;
}

export type PersistentJsonFallback<T> = T | (() => T);

export interface PersistentJsonAtomStorage extends KeyValueStorage {
  removeItem?(key: string): void | Promise<void>;
}

export interface CreatePersistentJsonAtomOptions<T> {
  fallback: PersistentJsonFallback<T>;
  key: string;
  normalize?: (value: unknown) => T | null | undefined;
  storage: PersistentJsonAtomStorage;
}

export interface PersistentJsonAtom<T> {
  clear(): Promise<void>;
  key: string;
  read(): Promise<T>;
  write(value: T): Promise<void>;
}

export function isAppsInTossAnonymousHash(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.startsWith(APPS_IN_TOSS_ANONYMOUS_HASH_PREFIX) &&
    value.slice(APPS_IN_TOSS_ANONYMOUS_HASH_PREFIX.length).trim().length > 0
  );
}

export async function resolveAppsInTossAnonymousHash({
  createDevFallback = () => createAnonymousHash({ prefix: "dev-anon" }),
  getAnonymousKey = defaultGetAnonymousKey,
  production = isProductionRuntime(),
}: ResolveAppsInTossAnonymousHashOptions = {}): Promise<string> {
  try {
    const result = (await getAnonymousKey()) as AppsInTossAnonymousKeyResult;
    const normalizedHash = anonymousHashFromResult(result);
    if (normalizedHash) {
      return isAppsInTossAnonymousHash(normalizedHash)
        ? normalizedHash
        : `${APPS_IN_TOSS_ANONYMOUS_HASH_PREFIX}${normalizedHash}`;
    }
    if (production) {
      throw identityErrorFromResult(result);
    }
  } catch (error) {
    if (production) {
      if (error instanceof AppsInTossIdentityError) {
        throw error;
      }
      throw new AppsInTossIdentityError({
        cause: error,
        code: "ANONYMOUS_KEY_THROWN",
        message: "Apps in Toss anonymous key request failed.",
      });
    }
  }

  return createDevFallback();
}

export function createAppsInTossIdentityStorage(
  storage: KeyValueStorage,
  {
    anonymousHashStorageKey = DEFAULT_APPS_IN_TOSS_ANONYMOUS_HASH_STORAGE_KEY,
    appSessionStorageKey = DEFAULT_APPS_IN_TOSS_APP_SESSION_STORAGE_KEY,
    ...resolverOptions
  }: CreateAppsInTossIdentityStorageOptions = {},
): KeyValueStorage {
  const production = resolverOptions.production ?? isProductionRuntime();

  async function resolveStoredAnonymousHash() {
    const existing = await storage.getItem(anonymousHashStorageKey);
    if (existing && (!production || isAppsInTossAnonymousHash(existing))) {
      return { refreshed: false, value: existing };
    }

    const next = await resolveAppsInTossAnonymousHash({
      ...resolverOptions,
      production,
    });
    await storage.setItem(anonymousHashStorageKey, next);
    return { refreshed: existing !== next, value: next };
  }

  return {
    async getItem(key) {
      if (key === anonymousHashStorageKey) {
        return (await resolveStoredAnonymousHash()).value;
      }

      if (production && isAppSessionStorageKey(key, appSessionStorageKey)) {
        const { refreshed } = await resolveStoredAnonymousHash();
        if (refreshed) {
          return null;
        }
      }

      return storage.getItem(key);
    },
    setItem: (key, value) => storage.setItem(key, value),
  };
}

export function createAppsInTossSessionStorage({
  appKey,
  env,
  storage,
  fallbackStorage,
  allowFallback,
  productionRequired,
  ...resolverOptions
}: CreateAppsInTossSessionStorageOptions): AppsInTossSessionStorage {
  const normalizedAppKey = appKey.trim();
  if (!normalizedAppKey) {
    throw new TypeError("Apps in Toss appKey is required.");
  }

  const resolvedEnv = resolveRuntimeEnv({
    env,
    production: resolverOptions.production,
  });
  const production = resolverOptions.production ?? isProductionEnv(resolvedEnv);
  const anonymousHashStorageKey = `${normalizedAppKey}.anonymousHash`;
  const appSessionStorageKey = `${normalizedAppKey}.appSession`;
  const tossSessionStorageKey = `${normalizedAppKey}.tossSession`;
  const keyValueStorage = createAppsInTossKeyValueStorage({
    allowFallback,
    env: production ? "production" : resolvedEnv,
    fallbackStorage,
    productionRequired: production ? true : productionRequired,
    storage,
  });

  return {
    anonymousHashStorageKey,
    appSessionStorageKey,
    storage: createAppsInTossIdentityStorage(keyValueStorage, {
      ...resolverOptions,
      anonymousHashStorageKey,
      appSessionStorageKey,
      production,
    }),
    tossSessionStorageKey,
  };
}

export function createAppsInTossLoginBridge({
  appLogin,
  createDevFallback = createDefaultLoginFallback,
  env,
  getIsTossLoginIntegratedService,
  production,
}: CreateAppsInTossLoginBridgeOptions = {}): AppsInTossLoginBridge {
  const resolvedProduction =
    production ?? isProductionEnv(resolveRuntimeEnv({ env, production }));

  return {
    async appLogin() {
      const resolvedAppLogin =
        appLogin ?? (await defaultFrameworkFunction("appLogin"));

      if (!resolvedAppLogin) {
        return handleLoginBridgeUnavailable({
          createDevFallback,
          production: resolvedProduction,
        });
      }

      try {
        return await resolvedAppLogin();
      } catch (error) {
        if (resolvedProduction) {
          throw new AppsInTossLoginBridgeError({
            cause: error,
            code: "APP_LOGIN_THROWN",
            message: "Apps in Toss appLogin request failed.",
          });
        }
        return createDevFallback();
      }
    },
    async getIsTossLoginIntegratedService() {
      const resolvedCheck =
        getIsTossLoginIntegratedService ??
        (await defaultFrameworkFunction("getIsTossLoginIntegratedService"));

      if (!resolvedCheck) {
        return undefined;
      }

      try {
        const result = await resolvedCheck();
        return result === false ? undefined : result;
      } catch (error) {
        if (resolvedProduction) {
          throw new AppsInTossLoginBridgeError({
            cause: error,
            code: "TOSS_LOGIN_INTEGRATION_CHECK_THROWN",
            message: "Apps in Toss login integration check failed.",
          });
        }
        return undefined;
      }
    },
  };
}

export function ensureAppsInTossHapticFallback({
  nativeModules,
}: EnsureAppsInTossHapticFallbackOptions = {}): boolean {
  try {
    if (!nativeModules) {
      return false;
    }

    const graniteModule = nativeModules.GraniteModule;
    const bedrockModule = nativeModules.BedrockModule;
    if (
      typeof graniteModule?.generateHapticFeedback === "function" ||
      typeof bedrockModule?.generateHapticFeedback === "function"
    ) {
      return true;
    }

    const hapticModule = graniteModule ?? bedrockModule ?? {};
    const fallbackGenerateHapticFeedback = async () => undefined;
    Object.defineProperty(nativeModules, "GraniteModule", {
      configurable: true,
      enumerable: true,
      value: {
        ...hapticModule,
        generateHapticFeedback: fallbackGenerateHapticFeedback,
      },
      writable: true,
    });
    if (bedrockModule) {
      Object.defineProperty(nativeModules, "BedrockModule", {
        configurable: true,
        enumerable: true,
        value: {
          ...bedrockModule,
          generateHapticFeedback: fallbackGenerateHapticFeedback,
        },
        writable: true,
      });
    }
    return true;
  } catch {
    return false;
  }
}

export function createPersistentJsonAtom<T>({
  fallback,
  key,
  normalize,
  storage,
}: CreatePersistentJsonAtomOptions<T>): PersistentJsonAtom<T> {
  const atom: PersistentJsonAtom<T> = {
    async clear() {
      try {
        if (typeof storage.removeItem === "function") {
          await storage.removeItem(key);
          return;
        }
        await storage.setItem(key, "");
      } catch {
        // Best-effort local state cleanup should never break app bootstrap.
      }
    },
    key,
    async read() {
      let raw: string | null;
      try {
        raw = await storage.getItem(key);
      } catch {
        return resolveFallback(fallback);
      }

      if (!raw) {
        return resolveFallback(fallback);
      }

      try {
        const parsed = JSON.parse(raw) as unknown;
        if (!normalize) {
          return parsed as T;
        }
        const normalized = normalize(parsed);
        if (normalized === null || normalized === undefined) {
          throw new Error("Persistent JSON atom value failed normalization.");
        }
        return normalized;
      } catch {
        await atom.clear();
        return resolveFallback(fallback);
      }
    },
    async write(value) {
      try {
        await storage.setItem(key, JSON.stringify(value));
      } catch {
        // Persisted UI state is optional; callers can continue with memory state.
      }
    },
  };
  return atom;
}

function anonymousHashFromResult(
  result: AppsInTossAnonymousKeyResult,
): string | null {
  if (
    result &&
    typeof result === "object" &&
    result.type === "HASH" &&
    typeof result.hash === "string"
  ) {
    const hash = result.hash.trim();
    return hash.length > 0 ? hash : null;
  }
  return null;
}

function identityErrorFromResult(
  result: AppsInTossAnonymousKeyResult,
): AppsInTossIdentityError {
  if (result === undefined) {
    return new AppsInTossIdentityError({
      code: "ANONYMOUS_KEY_UNSUPPORTED",
      message: "Apps in Toss anonymous key is not supported in this runtime.",
    });
  }
  if (result === "ERROR") {
    return new AppsInTossIdentityError({
      code: "ANONYMOUS_KEY_ERROR",
      message: "Apps in Toss anonymous key request returned ERROR.",
    });
  }
  if (result === "INVALID_CATEGORY") {
    return new AppsInTossIdentityError({
      code: "ANONYMOUS_KEY_INVALID_CATEGORY",
      message: "Apps in Toss anonymous key is only available for non-game mini-apps.",
    });
  }
  return new AppsInTossIdentityError({
    cause: result,
    code: "ANONYMOUS_KEY_INVALID_RESPONSE",
    message: "Apps in Toss anonymous key response was invalid.",
  });
}

function isProductionRuntime() {
  return isProductionEnv(readRuntimeEnv());
}

function isProductionEnv(env: string | undefined) {
  return env?.trim().toLowerCase() === "production";
}

function readRuntimeEnv() {
  return readEnv("APP_ENV") ?? readEnv("NODE_ENV");
}

function resolveRuntimeEnv({
  env,
  production,
}: {
  env?: string;
  production?: boolean;
}) {
  if (env !== undefined) {
    return env;
  }
  if (production === true) {
    return "production";
  }
  if (production === false) {
    return "development";
  }
  return readRuntimeEnv() ?? "";
}

function readEnv(name: string) {
  if (typeof process === "undefined") {
    return undefined;
  }
  return process.env?.[name]?.trim().toLowerCase();
}

function isAppSessionStorageKey(
  key: string,
  appSessionStorageKey: string | readonly string[],
) {
  if (Array.isArray(appSessionStorageKey)) {
    return appSessionStorageKey.includes(key);
  }
  return key === appSessionStorageKey;
}

async function handleLoginBridgeUnavailable({
  createDevFallback,
  production,
}: {
  createDevFallback: () => unknown | Promise<unknown>;
  production: boolean;
}) {
  if (production) {
    throw new AppsInTossLoginBridgeError({
      code: "APP_LOGIN_UNAVAILABLE",
      message: "Apps in Toss appLogin is not available in this runtime.",
    });
  }
  return createDevFallback();
}

function createDefaultLoginFallback() {
  return {
    authorizationCode: createAnonymousHash({ prefix: "dev-auth" }),
    referrer: "SANDBOX",
  };
}

function resolveFallback<T>(fallback: PersistentJsonFallback<T>) {
  return typeof fallback === "function" ? (fallback as () => T)() : fallback;
}

async function defaultFrameworkFunction<
  K extends keyof AppsInTossFrameworkModule,
>(key: K): Promise<AppsInTossFrameworkModule[K] | undefined> {
  try {
    const framework = (await import(
      "@apps-in-toss/framework"
    )) as AppsInTossFrameworkModule;
    return framework[key];
  } catch {
    return undefined;
  }
}

async function defaultGetAnonymousKey() {
  const framework = (await import(
    "@apps-in-toss/framework"
  )) as AppsInTossFrameworkModule;
  return framework.getAnonymousKey?.();
}
