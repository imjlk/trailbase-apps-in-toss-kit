import { createReactNativeStorage } from "@ait-kit/sdk/rn";
import {
  createAppsInTossKeyValueStorage,
  type AppsInTossStorageBridge,
  type CreateAppsInTossKeyValueStorageOptions,
  type KeyValueStorage,
} from "@trailbase-apps-in-toss-kit/trailbase-client";
import {
  createAppsInTossIdentityStorage,
  type ResolveAppsInTossAnonymousHashOptions,
  type CreateAppsInTossIdentityStorageOptions,
} from "./identity";
import { isProductionEnv, resolveRuntimeEnv } from "./internal/runtime";

export interface CreateAppsInTossSessionStorageOptions
  extends ResolveAppsInTossAnonymousHashOptions,
    Pick<CreateAppsInTossIdentityStorageOptions, "revalidateAnonymousHash">,
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

export * from "@trailbase-apps-in-toss-kit/ait-core/storage";

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
      appSessionStorageKey: [appSessionStorageKey, tossSessionStorageKey],
      production,
    }),
    tossSessionStorageKey,
  };
}

/**
 * Native storage bridge backed by @ait-kit/sdk's React Native storage
 * adapter (lazy official-module acquisition, verbatim keys). Pass this as
 * `storage` to `createAppsInTossSessionStorage` instead of wiring the
 * official `Storage` namespace by hand.
 */
export function createAppsInTossSdkStorageBridge(): AppsInTossStorageBridge {
  const sdkStorage = createReactNativeStorage();
  return {
    getItem: (key) => sdkStorage.get(key),
    removeItem: (key) => sdkStorage.remove(key),
    setItem: (key, value) => sdkStorage.set(key, value),
  };
}

