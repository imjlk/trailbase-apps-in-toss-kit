import { createReactNativeIdentity } from "@ait-kit/sdk/rn";
import {
  createAnonymousHash,
  type KeyValueStorage,
} from "@trailbase-apps-in-toss-kit/trailbase-client";
import {
  type AppsInTossGetAnonymousKey,
} from "./internal/framework";
import { isProductionRuntime } from "./internal/runtime";
import { isSdkError } from "./internal/sdk-errors";

export type { AppsInTossGetAnonymousKey } from "./internal/framework";

export const APPS_IN_TOSS_ANONYMOUS_HASH_PREFIX = "ait:";
export const DEFAULT_APPS_IN_TOSS_ANONYMOUS_HASH_STORAGE_KEY =
  "trailbase.anonymousHash";
export const DEFAULT_APPS_IN_TOSS_APP_SESSION_STORAGE_KEY =
  "trailbase.appSession";

export type AppsInTossAnonymousKeyResult =
  | Awaited<ReturnType<AppsInTossGetAnonymousKey>>
  | "INVALID_CATEGORY";

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
      const prefixedHash = normalizedHash.startsWith(
        APPS_IN_TOSS_ANONYMOUS_HASH_PREFIX,
      )
        ? normalizedHash
        : `${APPS_IN_TOSS_ANONYMOUS_HASH_PREFIX}${normalizedHash}`;
      if (isAppsInTossAnonymousHash(prefixedHash)) {
        return prefixedHash;
      }
    }
    if (production) {
      throw identityErrorFromResult(result);
    }
  } catch (error) {
    if (production) {
      if (error instanceof AppsInTossIdentityError) {
        throw error;
      }
      if (isSdkError(error)) {
        // The @ait-kit/sdk default path validates the provider result:
        // below-minimum app versions surface as UNSUPPORTED and anything
        // uninterpretable (the "ERROR" sentinel included) as
        // INVALID_ANONYMOUS_KEY, which collapses into the invalid-response
        // category here.
        throw new AppsInTossIdentityError({
          cause: error,
          code:
            error.code === "UNSUPPORTED"
              ? "ANONYMOUS_KEY_UNSUPPORTED"
              : "ANONYMOUS_KEY_INVALID_RESPONSE",
          message: "Apps in Toss anonymous key request failed.",
        });
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
      message:
        "Apps in Toss anonymous key is only available for non-game mini-apps.",
    });
  }
  return new AppsInTossIdentityError({
    cause: result,
    code: "ANONYMOUS_KEY_INVALID_RESPONSE",
    message: "Apps in Toss anonymous key response was invalid.",
  });
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

/**
 * Default anonymous-key lookup delegated to @ait-kit/sdk's identity
 * adapter: it acquires the official framework module (converting the flat
 * RN exports), validates the { type: "HASH", hash } shape, and maps the
 * below-minimum-version `undefined` sentinel to UNSUPPORTED. Injected
 * `getAnonymousKey` functions bypass the adapter and keep TrailBase's
 * precise sentinel taxonomy (ERROR / INVALID_CATEGORY).
 */
async function defaultGetAnonymousKey(): Promise<
  Awaited<ReturnType<AppsInTossGetAnonymousKey>>
> {
  try {
    return await createReactNativeIdentity().getAnonymousKey();
  } catch (error) {
    if (isSdkError(error) && error.code === "SDK_UNAVAILABLE") {
      // Function-absent and module-absent both surface as "no key" so the
      // existing production/dev fallback split keeps applying.
      return undefined;
    }
    throw error;
  }
}
