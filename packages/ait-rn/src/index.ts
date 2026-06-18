import {
  createAnonymousHash,
  type KeyValueStorage,
} from "@trailbase-apps-in-toss-kit/trailbase-client";

export const APPS_IN_TOSS_RN_ANONYMOUS_HASH_PREFIX = "ait:";
export const DEFAULT_APPS_IN_TOSS_RN_ANONYMOUS_HASH_STORAGE_KEY =
  "trailbase.anonymousHash";

export type AppsInTossRnAnonymousKeyResult =
  | { type: "HASH"; hash: string }
  | "ERROR"
  | "INVALID_CATEGORY"
  | undefined;

export type AppsInTossRnGetAnonymousKey = () => Promise<unknown>;

type AppsInTossFrameworkModule = {
  getAnonymousKey?: AppsInTossRnGetAnonymousKey;
};

export type AppsInTossRnIdentityErrorCode =
  | "ANONYMOUS_KEY_ERROR"
  | "ANONYMOUS_KEY_INVALID_CATEGORY"
  | "ANONYMOUS_KEY_INVALID_RESPONSE"
  | "ANONYMOUS_KEY_THROWN"
  | "ANONYMOUS_KEY_UNSUPPORTED";

export interface AppsInTossRnIdentityErrorOptions {
  cause?: unknown;
  code: AppsInTossRnIdentityErrorCode;
  message: string;
}

export class AppsInTossRnIdentityError extends Error {
  code: AppsInTossRnIdentityErrorCode;
  override cause?: unknown;

  constructor({ cause, code, message }: AppsInTossRnIdentityErrorOptions) {
    super(message);
    this.name = "AppsInTossRnIdentityError";
    this.code = code;
    this.cause = cause;
  }
}

export interface ResolveAppsInTossRnAnonymousHashOptions {
  createDevFallback?: () => string;
  getAnonymousKey?: AppsInTossRnGetAnonymousKey;
  production?: boolean;
}

export interface CreateAppsInTossRnIdentityStorageOptions
  extends ResolveAppsInTossRnAnonymousHashOptions {
  anonymousHashStorageKey?: string;
}

export function isAppsInTossRnAnonymousHash(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.startsWith(APPS_IN_TOSS_RN_ANONYMOUS_HASH_PREFIX) &&
    value.slice(APPS_IN_TOSS_RN_ANONYMOUS_HASH_PREFIX.length).trim().length > 0
  );
}

export async function resolveAppsInTossRnAnonymousHash({
  createDevFallback = () => createAnonymousHash({ prefix: "dev-anon" }),
  getAnonymousKey = defaultGetAnonymousKey,
  production = isProductionRuntime(),
}: ResolveAppsInTossRnAnonymousHashOptions = {}): Promise<string> {
  try {
    const result = (await getAnonymousKey()) as AppsInTossRnAnonymousKeyResult;
    const normalizedHash = anonymousHashFromResult(result);
    if (normalizedHash) {
      return `${APPS_IN_TOSS_RN_ANONYMOUS_HASH_PREFIX}${normalizedHash}`;
    }
    if (production) {
      throw identityErrorFromResult(result);
    }
  } catch (error) {
    if (production) {
      if (error instanceof AppsInTossRnIdentityError) {
        throw error;
      }
      throw new AppsInTossRnIdentityError({
        cause: error,
        code: "ANONYMOUS_KEY_THROWN",
        message: "Apps in Toss anonymous key request failed.",
      });
    }
  }

  return createDevFallback();
}

export function createAppsInTossRnIdentityStorage(
  storage: KeyValueStorage,
  {
    anonymousHashStorageKey = DEFAULT_APPS_IN_TOSS_RN_ANONYMOUS_HASH_STORAGE_KEY,
    ...resolverOptions
  }: CreateAppsInTossRnIdentityStorageOptions = {},
): KeyValueStorage {
  const production = resolverOptions.production ?? isProductionRuntime();

  return {
    async getItem(key) {
      if (key !== anonymousHashStorageKey) {
        return storage.getItem(key);
      }

      const existing = await storage.getItem(key);
      if (existing && (!production || isAppsInTossRnAnonymousHash(existing))) {
        return existing;
      }

      const next = await resolveAppsInTossRnAnonymousHash({
        ...resolverOptions,
        production,
      });
      await storage.setItem(key, next);
      return next;
    },
    setItem: (key, value) => storage.setItem(key, value),
  };
}

function anonymousHashFromResult(
  result: AppsInTossRnAnonymousKeyResult,
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
  result: AppsInTossRnAnonymousKeyResult,
): AppsInTossRnIdentityError {
  if (result === undefined) {
    return new AppsInTossRnIdentityError({
      code: "ANONYMOUS_KEY_UNSUPPORTED",
      message: "Apps in Toss anonymous key is not supported in this runtime.",
    });
  }
  if (result === "ERROR") {
    return new AppsInTossRnIdentityError({
      code: "ANONYMOUS_KEY_ERROR",
      message: "Apps in Toss anonymous key request returned ERROR.",
    });
  }
  if (result === "INVALID_CATEGORY") {
    return new AppsInTossRnIdentityError({
      code: "ANONYMOUS_KEY_INVALID_CATEGORY",
      message: "Apps in Toss anonymous key is only available for non-game mini-apps.",
    });
  }
  return new AppsInTossRnIdentityError({
    cause: result,
    code: "ANONYMOUS_KEY_INVALID_RESPONSE",
    message: "Apps in Toss anonymous key response was invalid.",
  });
}

function isProductionRuntime() {
  return (
    readEnv("PM_APP_ENV") === "production" ||
    readEnv("APP_ENV") === "production" ||
    readEnv("NODE_ENV") === "production"
  );
}

function readEnv(name: string) {
  if (typeof process === "undefined") {
    return undefined;
  }
  return process.env?.[name]?.trim();
}

async function defaultGetAnonymousKey() {
  const framework = (await import(
    "@apps-in-toss/framework"
  )) as AppsInTossFrameworkModule;
  return framework.getAnonymousKey?.();
}
