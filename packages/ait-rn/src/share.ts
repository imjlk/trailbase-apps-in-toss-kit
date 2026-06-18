import {
  defaultFrameworkFunction,
  type AppsInTossGetSchemeUri,
  type AppsInTossGetTossShareLink,
  type AppsInTossShare,
} from "./internal/framework";

export type {
  AppsInTossGetSchemeUri,
  AppsInTossGetTossShareLink,
  AppsInTossShare,
} from "./internal/framework";

export type AppsInTossDeepLinkQueryValue =
  | boolean
  | null
  | number
  | readonly (boolean | number | string)[]
  | string
  | undefined;

export type AppsInTossDeepLinkQuery =
  | Record<string, AppsInTossDeepLinkQueryValue>
  | URLSearchParams
  | string;

export type AppsInTossOgPrewarmFetcher = (
  input: string,
  init: {
    headers: Record<string, string>;
    method: "GET";
  },
) => Promise<unknown>;

export interface ResolveAppsInTossDeepLinkOptions {
  appName?: string;
  deepLink?: string | null;
  path?: string | null;
  query?: AppsInTossDeepLinkQuery;
}

export interface NormalizeAppsInTossOgImageUrlOptions {
  allowDevHttp?: boolean;
  allowLocalHttp?: boolean;
  dev?: boolean;
}

export interface PrewarmAppsInTossOgImageOptions {
  fetcher?: AppsInTossOgPrewarmFetcher;
  timeoutMs?: number;
}

export interface BuildAppsInTossShareMessageOptions {
  message?: string | null;
  messageLines?: readonly (string | null | undefined)[];
  separator?: string;
  tossLink: string;
}

export interface ExtractAppsInTossSchemeValueOptions {
  pathPattern?: RegExp;
  queryKeys?: readonly string[];
}

export interface CreateAppsInTossShareBridgeOptions {
  fetcher?: AppsInTossOgPrewarmFetcher;
  getSchemeUri?: AppsInTossGetSchemeUri;
  getTossShareLink?: AppsInTossGetTossShareLink;
  ogPrewarmTimeoutMs?: number;
  share?: AppsInTossShare;
}

export interface CreateAppsInTossShareLinkOptions
  extends NormalizeAppsInTossOgImageUrlOptions,
    ResolveAppsInTossDeepLinkOptions {
  ogImageUrl?: string | null;
  prewarmOgImage?: boolean;
}

export interface ShareAppsInTossLinkOptions
  extends Omit<BuildAppsInTossShareMessageOptions, "tossLink">,
    CreateAppsInTossShareLinkOptions {
  tossLink?: string;
}

export interface AppsInTossShareBridge {
  createShareLink(options: CreateAppsInTossShareLinkOptions): Promise<string>;
  safeGetSchemeUri(): Promise<string | null>;
  shareLink(options: ShareAppsInTossLinkOptions): Promise<string>;
}

const DEFAULT_OG_PREWARM_TIMEOUT_MS = 1_500;

export function createAppsInTossShareBridge({
  fetcher,
  getSchemeUri,
  getTossShareLink,
  ogPrewarmTimeoutMs = DEFAULT_OG_PREWARM_TIMEOUT_MS,
  share,
}: CreateAppsInTossShareBridgeOptions = {}): AppsInTossShareBridge {
  const createShareLink = async (options: CreateAppsInTossShareLinkOptions) => {
    const resolvedGetTossShareLink =
      getTossShareLink ?? (await defaultFrameworkFunction("getTossShareLink"));
    if (!resolvedGetTossShareLink) {
      throw new Error("Apps in Toss getTossShareLink is not available.");
    }

    const deepLink = resolveAppsInTossDeepLink(options);
    const normalizedOgImageUrl = normalizeAppsInTossOgImageUrl(
      options.ogImageUrl,
      options,
    );
    if (normalizedOgImageUrl && options.prewarmOgImage !== false) {
      await prewarmAppsInTossOgImage(normalizedOgImageUrl, {
        fetcher,
        timeoutMs: ogPrewarmTimeoutMs,
      });
    }
    return resolvedGetTossShareLink(deepLink, normalizedOgImageUrl);
  };

  const shareLink = async (options: ShareAppsInTossLinkOptions) => {
    const resolvedShare = share ?? (await defaultFrameworkFunction("share"));
    if (!resolvedShare) {
      throw new Error("Apps in Toss share is not available.");
    }

    const tossLink = options.tossLink ?? (await createShareLink(options));
    await resolvedShare({
      message: buildAppsInTossShareMessage({
        message: options.message,
        messageLines: options.messageLines,
        separator: options.separator,
        tossLink,
      }),
    });
    return tossLink;
  };

  return {
    createShareLink,
    async safeGetSchemeUri() {
      const resolvedGetSchemeUri =
        getSchemeUri ?? (await defaultFrameworkFunction("getSchemeUri"));
      try {
        return resolvedGetSchemeUri?.() ?? null;
      } catch {
        return null;
      }
    },
    shareLink,
  };
}

export function resolveAppsInTossDeepLink({
  appName,
  deepLink,
  path,
  query,
}: ResolveAppsInTossDeepLinkOptions) {
  const normalizedDeepLink = deepLink?.trim();
  const base =
    normalizedDeepLink && isAppsInTossDeepLink(normalizedDeepLink)
      ? normalizedDeepLink
      : buildAppsInTossDeepLink({
          appName,
          path: normalizedDeepLink ?? path,
        });

  return appendAppsInTossDeepLinkQuery(base, query);
}

export function normalizeAppsInTossOgImageUrl(
  value?: string | null,
  {
    allowDevHttp = false,
    allowLocalHttp = false,
    dev = false,
  }: NormalizeAppsInTossOgImageUrlOptions = {},
) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }

  try {
    const url = new URL(trimmed);
    if (url.protocol === "https:") {
      return url.toString();
    }
    if (
      url.protocol === "http:" &&
      ((allowLocalHttp && isLocalHttpUrl(url)) || (allowDevHttp && dev))
    ) {
      return url.toString();
    }
  } catch {
    return undefined;
  }

  return undefined;
}

export async function prewarmAppsInTossOgImage(
  ogImageUrl: string | null | undefined,
  {
    fetcher = defaultOgPrewarmFetcher(),
    timeoutMs = DEFAULT_OG_PREWARM_TIMEOUT_MS,
  }: PrewarmAppsInTossOgImageOptions = {},
) {
  if (!ogImageUrl || !fetcher) {
    return;
  }

  try {
    let clearPrewarmTimeout: (() => void) | undefined;
    try {
      await Promise.race([
        fetcher(ogImageUrl, {
          headers: { Accept: "image/png,image/*,*/*" },
          method: "GET",
        }),
        new Promise((resolve) => {
          const timeout = setTimeout(resolve, timeoutMs);
          clearPrewarmTimeout = () => clearTimeout(timeout);
        }),
      ]);
    } finally {
      clearPrewarmTimeout?.();
    }
  } catch {
    // OG warming should never block sharing; getTossShareLink can still use the URL.
  }
}

export function buildAppsInTossShareMessage({
  message,
  messageLines = [],
  separator = "\n\n",
  tossLink,
}: BuildAppsInTossShareMessageOptions) {
  const lines = [
    normalizeShareLine(message),
    ...messageLines.map(normalizeShareLine),
  ].filter((line): line is string => Boolean(line));

  if (lines.length === 0) {
    return tossLink;
  }
  return `${lines.join(separator)}${separator}${tossLink}`;
}

export function extractAppsInTossSchemeValue(
  schemeUri?: string | null,
  { pathPattern, queryKeys = [] }: ExtractAppsInTossSchemeValueOptions = {},
) {
  if (!schemeUri) {
    return null;
  }

  if (pathPattern) {
    const match = schemeUri.match(pathPattern);
    if (match?.[1]) {
      return safeDecodeURIComponent(match[1]);
    }
  }

  for (const key of queryKeys) {
    const value = queryValueFromScheme(schemeUri, key);
    if (value) {
      return value;
    }
  }

  return null;
}

function buildAppsInTossDeepLink({
  appName,
  path,
}: {
  appName?: string;
  path?: string | null;
}) {
  const normalizedAppName = appName?.trim();
  if (!normalizedAppName) {
    throw new TypeError("Apps in Toss appName is required.");
  }
  return `intoss://${normalizedAppName}${normalizeDeepLinkPath(path)}`;
}

function normalizeDeepLinkPath(path?: string | null) {
  const trimmed = path?.trim();
  if (!trimmed || trimmed === "/") {
    return "";
  }
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function appendAppsInTossDeepLinkQuery(
  deepLink: string,
  query?: AppsInTossDeepLinkQuery,
) {
  const searchParams = createSearchParams(query);
  if (isAppsInTossPrivateDeepLink(deepLink)) {
    const privateDeepLink = appendAppsInTossPrivateDeepLinkQueryParams(
      deepLink,
      searchParams ?? new URLSearchParams(),
    );
    if (privateDeepLink) {
      return privateDeepLink;
    }
  }

  if (!searchParams || Array.from(searchParams).length === 0) {
    return deepLink;
  }

  try {
    const url = new URL(deepLink);
    for (const [key, value] of searchParams) {
      url.searchParams.append(key, value);
    }
    return url.toString();
  } catch {
    const separator = deepLink.includes("?") ? "&" : "?";
    return `${deepLink}${separator}${searchParams.toString()}`;
  }
}

function appendAppsInTossPrivateDeepLinkQueryParams(
  deepLink: string,
  searchParams: URLSearchParams,
) {
  try {
    const url = new URL(deepLink);
    const privateTopLevelQueryParams =
      extractAppsInTossPrivateTopLevelQueryParams(url.searchParams);
    const mergedQueryParams = {
      ...parsePrivateQueryParams(url.searchParams.get("queryParams")),
      ...privateTopLevelQueryParams,
      ...searchParamsToQueryParamsObject(searchParams),
    };
    if (
      url.searchParams.has("queryParams") ||
      Object.keys(mergedQueryParams).length > 0
    ) {
      url.searchParams.set("queryParams", JSON.stringify(mergedQueryParams));
    }
    return url.toString();
  } catch {
    return null;
  }
}

function parsePrivateQueryParams(value: string | null) {
  if (!value) {
    return {};
  }
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
}

function extractAppsInTossPrivateTopLevelQueryParams(
  searchParams: URLSearchParams,
) {
  const routeParams = new URLSearchParams();
  for (const [key, value] of Array.from(searchParams)) {
    if (isAppsInTossPrivateReservedQueryParam(key)) {
      continue;
    }
    routeParams.append(key, value);
    searchParams.delete(key);
  }
  return searchParamsToQueryParamsObject(routeParams);
}

function isAppsInTossPrivateReservedQueryParam(key: string) {
  return key === "queryParams" || key.startsWith("_");
}

function searchParamsToQueryParamsObject(searchParams: URLSearchParams) {
  const result: Record<string, string | string[]> = {};
  for (const [key, value] of searchParams) {
    const existing = result[key];
    if (existing === undefined) {
      result[key] = value;
      continue;
    }
    if (Array.isArray(existing)) {
      existing.push(value);
      continue;
    }
    result[key] = [existing, value];
  }
  return result;
}

function createSearchParams(query?: AppsInTossDeepLinkQuery) {
  if (query === undefined) {
    return undefined;
  }
  if (typeof query === "string" || query instanceof URLSearchParams) {
    return new URLSearchParams(query);
  }

  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === null || value === undefined) {
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        searchParams.append(key, String(item));
      }
      continue;
    }
    searchParams.set(key, String(value));
  }
  return searchParams;
}

function isAppsInTossDeepLink(value: string) {
  return value.startsWith("intoss://") || isAppsInTossPrivateDeepLink(value);
}

function isAppsInTossPrivateDeepLink(value: string) {
  return value.startsWith("intoss-private://");
}

function isLocalHttpUrl(url: URL) {
  return (
    url.hostname === "127.0.0.1" ||
    url.hostname === "localhost" ||
    url.hostname === "::1"
  );
}

function normalizeShareLine(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function defaultOgPrewarmFetcher(): AppsInTossOgPrewarmFetcher | undefined {
  const fetcher = globalThis.fetch?.bind(globalThis);
  if (!fetcher) {
    return undefined;
  }
  return (input, init) => fetcher(input, init);
}

function queryValueFromScheme(schemeUri: string, key: string) {
  try {
    const value = new URL(schemeUri).searchParams.get(key);
    if (value) {
      return value;
    }
  } catch {
    // Fall through to regex parsing for non-standard local test strings.
  }

  const match = schemeUri.match(
    new RegExp(`[?&]${escapeRegExp(key)}=([^&#]+)`),
  );
  return match?.[1] ? safeDecodeURIComponent(match[1]) : null;
}

function safeDecodeURIComponent(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
