export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

type PortableBodyInit = NonNullable<RequestInit["body"]>;

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
  const preparedBody = prepareRequestBody(body);
  const response = await fetchImpl(url, {
    ...requestInit,
    headers: buildJsonHeaders(headers, body),
    body: preparedBody,
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

export type AppsInTossReferrer = "DEFAULT" | "SANDBOX" | string;

export interface AppsInTossLoginResult {
  authorizationCode: string;
  referrer: AppsInTossReferrer;
}

export interface StoredAppSession<TUser = unknown> {
  authProvider: "anonymous" | "toss";
  sessionToken: string;
  user: TUser;
}

export interface AppSessionManagerResponse<TUser = unknown> {
  sessionToken: string;
  user: TUser;
  [key: string]: unknown;
}

export interface AppsInTossSessionManagerOptions<TUser = unknown> {
  storage: KeyValueStorage;
  appLogin: () => Promise<unknown>;
  getIsTossLoginIntegratedService?: () => Promise<unknown>;
  loadSession: (input: { sessionToken: string }) => Promise<AppSessionManagerResponse<TUser>>;
  bootstrap: (anonymousHash: string) => Promise<AppSessionManagerResponse<TUser>>;
  completeTossLogin: (input: {
    anonymousHash: string;
    authorizationCode: string;
    referrer: AppsInTossReferrer;
  }) => Promise<AppSessionManagerResponse<TUser>>;
  createAnonymousHash?: () => string;
  anonymousHashStorageKey?: string;
  tossSessionStorageKey?: string;
  appSessionStorageKey?: string;
}

export class AppsInTossLoginError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AppsInTossLoginError";
  }
}

export function normalizeAppsInTossLoginResult(value: unknown): AppsInTossLoginResult {
  if (!value || typeof value !== "object") {
    throw new AppsInTossLoginError("토스 로그인을 완료하지 못했어요.");
  }
  const record = value as Record<string, unknown>;
  const authorizationCode = stringCandidate(record.authorizationCode, record.authorization_code);
  if (!authorizationCode) {
    throw new AppsInTossLoginError("토스 로그인 응답을 확인하지 못했어요.");
  }
  return {
    authorizationCode,
    referrer: normalizeAppsInTossReferrer(stringCandidate(record.referrer)),
  };
}

export function normalizeAppsInTossReferrer(value: unknown): AppsInTossReferrer {
  if (typeof value !== "string" || !value.trim()) {
    return "DEFAULT";
  }
  const trimmed = value.trim();
  if (trimmed.toUpperCase() === "SANDBOX") {
    return "SANDBOX";
  }
  if (trimmed.toUpperCase() === "DEFAULT") {
    return "DEFAULT";
  }
  return trimmed;
}

export function normalizeAppsInTossErrorMessage(
  error: unknown,
  fallback = "요청을 완료하지 못했어요.",
): string {
  const message = readableErrorMessage(error);
  if (!message || message === "[object Object]" || message === "undefined") {
    return fallback;
  }
  return message
    .replace(/\bTrailBase\b/gi, "서비스")
    .replace(/\bXMLHttpRequest\b/g, "요청")
    .replace(/\bfetch\b/gi, "요청")
    .trim();
}

export async function requestAppsInTossLogin({
  appLogin,
  getIsTossLoginIntegratedService,
}: {
  appLogin: () => Promise<unknown>;
  getIsTossLoginIntegratedService?: () => Promise<unknown>;
}): Promise<AppsInTossLoginResult> {
  if (getIsTossLoginIntegratedService) {
    try {
      const integrated = await getIsTossLoginIntegratedService();
      if (integrated === false) {
        throw new AppsInTossLoginError("토스 로그인이 아직 준비되지 않았어요.");
      }
    } catch (error) {
      if (error instanceof AppsInTossLoginError) {
        throw error;
      }
      throw new AppsInTossLoginError(
        normalizeAppsInTossErrorMessage(error, "토스 로그인 상태를 확인하지 못했어요."),
      );
    }
  }

  try {
    return normalizeAppsInTossLoginResult(await appLogin());
  } catch (error) {
    if (error instanceof AppsInTossLoginError) {
      throw error;
    }
    throw new AppsInTossLoginError(
      normalizeAppsInTossErrorMessage(error, "토스 로그인을 완료하지 못했어요."),
    );
  }
}

export function createAppsInTossSessionManager<TUser = unknown>({
  storage,
  appLogin,
  getIsTossLoginIntegratedService,
  loadSession,
  bootstrap,
  completeTossLogin,
  createAnonymousHash: createHash = createAnonymousHash,
  anonymousHashStorageKey = "trailbase.anonymousHash",
  tossSessionStorageKey = "trailbase.tossSession",
  appSessionStorageKey = "trailbase.appSession",
}: AppsInTossSessionManagerOptions<TUser>) {
  async function restoreStoredTossSession() {
    const storedSession = await readStoredSession<TUser>(storage, tossSessionStorageKey);
    if (!storedSession) {
      return null;
    }
    try {
      const response = await loadSession({ sessionToken: storedSession.sessionToken });
      await writeSession(storage, tossSessionStorageKey, response, "toss");
      await writeSession(storage, appSessionStorageKey, response, "toss");
      return withAuthProvider(response, "toss");
    } catch {
      await storage.setItem(tossSessionStorageKey, "");
      return null;
    }
  }

  async function restoreStoredAppSession() {
    const storedSession = await readStoredSession<TUser>(storage, appSessionStorageKey);
    if (!storedSession) {
      return await restoreStoredTossSession();
    }
    try {
      const response = await loadSession({ sessionToken: storedSession.sessionToken });
      await writeSession(storage, appSessionStorageKey, response, storedSession.authProvider);
      return withAuthProvider(response, storedSession.authProvider);
    } catch {
      await storage.setItem(appSessionStorageKey, "");
      if (storedSession.authProvider === "toss") {
        await storage.setItem(tossSessionStorageKey, "");
      }
      return null;
    }
  }

  async function bootstrapAnonymousSession() {
    const anonymousHash = await resolveAnonymousHash({
      storage,
      storageKey: anonymousHashStorageKey,
      create: createHash,
    });
    const response = await bootstrap(anonymousHash);
    await writeSession(storage, appSessionStorageKey, response, "anonymous");
    return withAuthProvider(response, "anonymous");
  }

  async function getOrCreateAppSession() {
    return (await restoreStoredAppSession()) ?? (await bootstrapAnonymousSession());
  }

  async function signInWithToss() {
    const [anonymousHash, loginResult] = await Promise.all([
      resolveAnonymousHash({ storage, storageKey: anonymousHashStorageKey, create: createHash }),
      requestAppsInTossLogin({ appLogin, getIsTossLoginIntegratedService }),
    ]);
    const response = await completeTossLogin({
      anonymousHash,
      authorizationCode: loginResult.authorizationCode,
      referrer: loginResult.referrer,
    });
    await writeSession(storage, tossSessionStorageKey, response, "toss");
    await writeSession(storage, appSessionStorageKey, response, "toss");
    return withAuthProvider(response, "toss");
  }

  async function getOrSignInWithToss() {
    return (await restoreStoredTossSession()) ?? (await signInWithToss());
  }

  return {
    restoreStoredTossSession,
    restoreStoredAppSession,
    bootstrapAnonymousSession,
    getOrCreateAppSession,
    signInWithToss,
    getOrSignInWithToss,
  };
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

function withAuthProvider<TUser>(
  response: AppSessionManagerResponse<TUser>,
  authProvider: "anonymous" | "toss",
) {
  return {
    ...response,
    authProvider,
  };
}

async function readStoredSession<TUser>(
  storage: KeyValueStorage,
  key: string,
): Promise<StoredAppSession<TUser> | null> {
  try {
    const raw = await storage.getItem(key);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    const record = parsed as Record<string, unknown>;
    if (record.authProvider !== "anonymous" && record.authProvider !== "toss") {
      return null;
    }
    const sessionToken = stringCandidate(record.sessionToken);
    if (!sessionToken || !record.user) {
      return null;
    }
    return {
      authProvider: record.authProvider,
      sessionToken,
      user: record.user as TUser,
    };
  } catch {
    return null;
  }
}

async function writeSession<TUser>(
  storage: KeyValueStorage,
  key: string,
  response: AppSessionManagerResponse<TUser>,
  authProvider: "anonymous" | "toss",
) {
  await storage.setItem(
    key,
    JSON.stringify({
      authProvider,
      sessionToken: response.sessionToken,
      user: response.user,
    }),
  );
}

function stringCandidate(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function readableErrorMessage(error: unknown): string | undefined {
  if (!error) {
    return undefined;
  }
  if (typeof error === "string") {
    return error;
  }
  if (typeof error === "number" || typeof error === "boolean") {
    return String(error);
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === "object") {
    const record = error as Record<string, unknown>;
    const candidates = [
      record.message,
      record.error,
      record.failureReason,
      record.reason,
      record.detail,
      record.cause,
      record.data,
      record.response,
    ];
    for (const candidate of candidates) {
      const message = readableErrorMessage(candidate);
      if (message) {
        return message;
      }
    }
  }
  return String(error);
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
  if (body !== undefined && body !== null && shouldUseJsonContentType(body) && !next.has("Content-Type")) {
    next.set("Content-Type", "application/json");
  }
  if (!next.has("Accept")) {
    next.set("Accept", "application/json");
  }
  return next;
}

function prepareRequestBody(body: unknown): PortableBodyInit | null | undefined {
  if (body === undefined || body === null) {
    return body;
  }
  if (isNativeBody(body)) {
    return body as PortableBodyInit;
  }
  return JSON.stringify(body);
}

function shouldUseJsonContentType(body: unknown) {
  return !isNativeBody(body) || typeof body === "string";
}

function isNativeBody(body: unknown) {
  return (
    typeof body === "string" ||
    isInstanceOfGlobal(body, "FormData") ||
    isInstanceOfGlobal(body, "URLSearchParams") ||
    isInstanceOfGlobal(body, "Blob") ||
    isInstanceOfGlobal(body, "ReadableStream") ||
    isInstanceOfGlobal(body, "ArrayBuffer") ||
    ArrayBuffer.isView(body)
  );
}

function isInstanceOfGlobal(value: unknown, name: string) {
  const ctor = (globalThis as unknown as Record<string, unknown>)[name];
  return typeof ctor === "function" && value instanceof ctor;
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
