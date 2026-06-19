export type AppsInTossHeaders =
  | Headers
  | Record<string, string | undefined>
  | readonly (readonly [string, string])[];

export type AppsInTossJsonFetcher = (
  input: string,
  init: RequestInit,
) => Promise<Response>;

export interface AppsInTossJsonPostOptions {
  body: unknown;
  fetcher?: AppsInTossJsonFetcher;
  getAuthHeaders?: () => AppsInTossHeaders | Promise<AppsInTossHeaders>;
  headers?: AppsInTossHeaders;
  path: string;
  baseUrl?: string;
}

export class AppsInTossClientRequestError extends Error {
  payload: unknown;
  status: number;
  statusText: string;

  constructor({
    message,
    payload,
    status,
    statusText,
  }: {
    message: string;
    payload: unknown;
    status: number;
    statusText: string;
  }) {
    super(message);
    this.name = "AppsInTossClientRequestError";
    this.payload = payload;
    this.status = status;
    this.statusText = statusText;
  }
}

export async function postAppsInTossJson({
  body,
  baseUrl,
  fetcher = defaultFetcher(),
  getAuthHeaders,
  headers,
  path,
}: AppsInTossJsonPostOptions) {
  const authHeaders = getAuthHeaders ? await getAuthHeaders() : undefined;
  const response = await fetcher(resolveClientUrl({ baseUrl, path }), {
    body: JSON.stringify(body),
    headers: normalizeHeaders({
      "Content-Type": "application/json",
      ...headersToRecord(headers),
      ...headersToRecord(authHeaders),
    }),
    method: "POST",
  });
  const text = await response.text();
  const payload = parseJsonResponseText(text);
  if (!response.ok) {
    throw new AppsInTossClientRequestError({
      message: normalizeClientRequestError(payload, response.statusText),
      payload,
      status: response.status,
      statusText: response.statusText,
    });
  }
  return payload;
}

export function resolveClientUrl({
  baseUrl,
  path,
}: {
  baseUrl?: string;
  path: string;
}) {
  const normalizedPath = path.trim();
  if (!normalizedPath) {
    throw new TypeError("Apps in Toss client endpoint is required.");
  }
  if (/^https?:\/\//i.test(normalizedPath)) {
    return normalizedPath;
  }

  const normalizedBaseUrl = baseUrl?.trim().replace(/\/+$/, "");
  const pathWithSlash = normalizedPath.startsWith("/")
    ? normalizedPath
    : `/${normalizedPath}`;
  return normalizedBaseUrl
    ? `${normalizedBaseUrl}${pathWithSlash}`
    : pathWithSlash;
}

export function normalizeHeaders(headers: Record<string, string | undefined>) {
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    const normalizedKey = key.trim();
    const normalizedValue = value?.trim();
    if (normalizedKey && normalizedValue) {
      normalized[normalizedKey] = normalizedValue;
    }
  }
  return normalized;
}

function headersToRecord(headers?: AppsInTossHeaders) {
  const record: Record<string, string | undefined> = {};
  if (!headers) {
    return record;
  }
  if (typeof Headers !== "undefined" && headers instanceof Headers) {
    headers.forEach((value, key) => {
      record[key] = value;
    });
    return record;
  }
  if (Array.isArray(headers)) {
    for (const [key, value] of headers) {
      record[key] = value;
    }
    return record;
  }
  return { ...headers };
}

function parseJsonResponseText(text: string) {
  if (!text.trim()) {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function normalizeClientRequestError(
  payload: unknown,
  fallback = "Apps in Toss client request failed.",
) {
  if (!payload) {
    return fallback;
  }
  if (typeof payload === "string") {
    return payload;
  }
  if (typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    for (const candidate of [
      record.message,
      record.error,
      record.reason,
      record.failureReason,
      record.failure_reason,
      record.detail,
    ]) {
      if (typeof candidate === "string" && candidate.trim()) {
        return candidate.trim();
      }
      if (candidate && typeof candidate === "object") {
        const nested = normalizeClientRequestError(candidate, "");
        if (nested) {
          return nested;
        }
      }
    }
  }
  return fallback;
}

function defaultFetcher() {
  if (!globalThis.fetch) {
    throw new Error("A fetch implementation is required.");
  }
  return globalThis.fetch.bind(globalThis) as AppsInTossJsonFetcher;
}
