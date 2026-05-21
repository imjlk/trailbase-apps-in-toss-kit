export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface RequestJsonOptions {
  fetchImpl?: typeof fetch;
  parseEmptyAsNull?: boolean;
  body?: unknown;
  headers?: Headers | Record<string, string> | [string, string][];
  [key: string]: unknown;
}

export class TrailBaseHttpError extends Error {
  status: number;
  statusText: string;
  payload: unknown;

  constructor(message: string, options: { status: number; statusText: string; payload: unknown }) {
    super(message);
    this.name = "TrailBaseHttpError";
    this.status = options.status;
    this.statusText = options.statusText;
    this.payload = options.payload;
  }
}

export function normalizeTrailBaseUrl(value: string, fallback?: string): string {
  const raw = (value || fallback || "").trim();
  if (!raw) {
    throw new Error("TrailBase base URL is required");
  }
  return raw.replace(/\/+$/, "");
}

export function joinTrailBaseUrl(baseUrl: string, path: string): string {
  const normalizedBase = normalizeTrailBaseUrl(baseUrl);
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
}

export async function requestJson<T = JsonValue>(
  url: string,
  init: RequestJsonOptions = {},
): Promise<T> {
  const {
    fetchImpl = globalThis.fetch,
    parseEmptyAsNull = true,
    headers,
    body,
    ...requestInit
  } = init;
  const response = await fetchImpl(url, {
    ...requestInit,
    headers: buildJsonHeaders(headers, body),
    body,
  } as RequestInit);
  const text = await response.text();
  const payload = parseJsonText(text, parseEmptyAsNull);
  if (!response.ok) {
    throw new TrailBaseHttpError(normalizeTrailBaseError(payload, response.statusText), {
      status: response.status,
      statusText: response.statusText,
      payload,
    });
  }
  return payload as T;
}

export function normalizeTrailBaseError(payload: unknown, fallback = "TrailBase request failed"): string {
  if (!payload) {
    return fallback;
  }
  if (typeof payload === "string") {
    return payload;
  }
  if (typeof payload === "object") {
    const value = payload as Record<string, unknown>;
    const candidates = [
      value.message,
      value.error,
      value.failureReason,
      value.reason,
      value.detail,
    ];
    for (const candidate of candidates) {
      if (typeof candidate === "string" && candidate.trim()) {
        return candidate;
      }
      if (candidate && typeof candidate === "object") {
        const nested = normalizeTrailBaseError(candidate, "");
        if (nested) {
          return nested;
        }
      }
    }
  }
  return fallback;
}

export interface KeyValueStorage {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): void | Promise<void>;
}

export async function resolveAnonymousHash({
  storage,
  storageKey = "trailbase.anonymousHash",
  create = createAnonymousHash,
}: {
  storage: KeyValueStorage;
  storageKey?: string;
  create?: () => string;
}): Promise<string> {
  const existing = await storage.getItem(storageKey);
  if (existing) {
    return existing;
  }
  const next = create();
  await storage.setItem(storageKey, next);
  return next;
}

export function createAnonymousHash({
  prefix = "anon",
  random = globalThis.crypto,
}: {
  prefix?: string;
  random?: { getRandomValues?: (array: Uint8Array) => Uint8Array };
} = {}): string {
  const bytes = new Uint8Array(16);
  if (random?.getRandomValues) {
    random.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${prefix}_${hex}`;
}

export interface SseEvent {
  event: string;
  data: string;
  id?: string;
  retry?: number;
}

export function createSseParser(onEvent: (event: SseEvent) => void) {
  let buffer = "";
  let eventName = "message";
  let data: string[] = [];
  let id: string | undefined;
  let retry: number | undefined;

  function dispatch() {
    if (data.length === 0) {
      eventName = "message";
      id = undefined;
      retry = undefined;
      return;
    }
    onEvent({
      event: eventName || "message",
      data: data.join("\n"),
      id,
      retry,
    });
    eventName = "message";
    data = [];
    id = undefined;
    retry = undefined;
  }

  function parseLine(line: string) {
    if (line === "") {
      dispatch();
      return;
    }
    if (line.startsWith(":")) {
      return;
    }

    const separatorIndex = line.indexOf(":");
    const field = separatorIndex >= 0 ? line.slice(0, separatorIndex) : line;
    let value = separatorIndex >= 0 ? line.slice(separatorIndex + 1) : "";
    if (value.startsWith(" ")) {
      value = value.slice(1);
    }

    if (field === "event") eventName = value;
    else if (field === "data") data.push(value);
    else if (field === "id") id = value;
    else if (field === "retry" && /^\d+$/.test(value)) retry = Number(value);
  }

  return {
    push(chunk: string) {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        parseLine(line);
      }
    },
    close() {
      if (buffer) {
        parseLine(buffer);
        buffer = "";
      }
      dispatch();
    },
  };
}

export interface XhrSseStreamOptions {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  XMLHttpRequestImpl?: typeof XMLHttpRequest;
  onEvent: (event: SseEvent) => void;
  onOpen?: () => void;
  onError?: (error: Error) => void;
}

export function createXhrSseStream({
  url,
  method = "GET",
  headers = {},
  body,
  XMLHttpRequestImpl = globalThis.XMLHttpRequest,
  onEvent,
  onOpen,
  onError,
}: XhrSseStreamOptions) {
  if (!XMLHttpRequestImpl) {
    throw new Error("XMLHttpRequest is required for XHR SSE streams");
  }

  const xhr = new XMLHttpRequestImpl();
  const parser = createSseParser(onEvent);
  let seen = 0;
  let opened = false;

  xhr.open(method, url, true);
  xhr.setRequestHeader("Accept", "text/event-stream");
  for (const [key, value] of Object.entries(headers)) {
    xhr.setRequestHeader(key, value);
  }
  xhr.onprogress = () => {
    if (!opened) {
      opened = true;
      onOpen?.();
    }
    const next = xhr.responseText.slice(seen);
    seen = xhr.responseText.length;
    parser.push(next);
  };
  xhr.onreadystatechange = () => {
    if (xhr.readyState === 2 && !opened) {
      opened = true;
      onOpen?.();
    }
    if (xhr.readyState === 4) {
      if (xhr.status >= 400) {
        onError?.(new Error(`SSE request failed with status ${xhr.status}`));
      }
      parser.close();
    }
  };
  xhr.onerror = () => onError?.(new Error("SSE request failed"));
  xhr.send(body);

  return {
    close() {
      xhr.abort();
    },
    xhr,
  };
}

function buildJsonHeaders(
  headers: Headers | Record<string, string> | [string, string][] | undefined,
  body: unknown,
) {
  const next = new Headers(headers);
  if (body !== undefined && body !== null && !next.has("Content-Type")) {
    next.set("Content-Type", "application/json");
  }
  if (!next.has("Accept")) {
    next.set("Accept", "application/json");
  }
  return next;
}

function parseJsonText(text: string, parseEmptyAsNull: boolean): unknown {
  if (!text.trim()) {
    return parseEmptyAsNull ? null : "";
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
