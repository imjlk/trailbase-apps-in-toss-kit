import {
  TrailBaseHttpError,
  createSseParser,
  normalizeTrailBaseError,
  normalizeTrailBaseUrl,
} from "./index";

export { createCollection, useLiveQuery } from "@tanstack/react-db";
export type { Collection } from "@tanstack/react-db";

export type RecordId = string | number;

export type TrailbaseEvent<Row> =
  | { Insert: Row }
  | { Update: Row }
  | { Delete: Row };

export interface TrailbaseRecordApi<Row> {
  list: (opts?: any) => Promise<{ records: Row[]; cursor?: string | null }>;
  subscribe: (id: any, options?: { signal?: AbortSignal }) => Promise<ReadableStream<any>>;
  subscribeAll?: (opts?: any) => Promise<ReadableStream<any>>;
}

// Accept both official SDK options and the adapter extension. The SDK may
// ignore signal; signal-aware fallbacks still receive it for cancellation.
export interface TrailbaseFallbackRecordApi<Row> {
  list: TrailbaseRecordApi<Row>["list"];
  subscribe: (id: any, options?: { signal?: AbortSignal; onLoss?: () => void }) => Promise<ReadableStream<any>>;
  subscribeAll?: TrailbaseRecordApi<Row>["subscribeAll"];
}

export interface XhrSseRecordApiOptions<Row> {
  apiBaseUrl: string;
  apiName: string;
  fallbackRecordApi: TrailbaseFallbackRecordApi<Row>;
  headers?: Record<string, string>;
  getHeaders?: () => Record<string, string> | Promise<Record<string, string>>;
  XMLHttpRequestImpl?: typeof XMLHttpRequest;
  connectionTimeoutMs?: number;
}

export function createTrailbaseRecordApiWithXhrSse<Row>({
  apiBaseUrl,
  apiName,
  fallbackRecordApi,
  headers,
  getHeaders,
  connectionTimeoutMs,
  XMLHttpRequestImpl = globalThis.XMLHttpRequest,
}: XhrSseRecordApiOptions<Row>): TrailbaseRecordApi<Row> {
  return new Proxy(fallbackRecordApi, {
    get(target, property, receiver) {
      if (property === "subscribe") {
        return (id: RecordId | "*", options?: { signal?: AbortSignal }) =>
          subscribeRecordEvents({
            apiBaseUrl,
            apiName,
            id,
            headers,
            getHeaders,
            XMLHttpRequestImpl,
            connectionTimeoutMs,
            signal: options?.signal,
            fallback: () => target.subscribe(id, options),
          });
      }
      if (property === "subscribeAll") {
        return (opts?: { filters?: unknown[]; signal?: AbortSignal }) =>
          (opts?.filters?.length ?? 0) > 0
            ? target.subscribeAll?.(opts) ?? target.subscribe("*", { signal: opts?.signal })
            : subscribeRecordEvents({
                apiBaseUrl,
                apiName,
                id: "*",
                headers,
                getHeaders,
                XMLHttpRequestImpl,
                connectionTimeoutMs,
                signal: opts?.signal,
                fallback: () => target.subscribeAll?.(opts) ?? target.subscribe("*", opts),
              });
      }
      return Reflect.get(target, property, receiver);
    },
  });
}

export interface RecordCollectionOptions<Row, Key, Collection, Config> {
  createCollection: (options: Config) => Collection;
  id: string;
  recordApi: TrailbaseRecordApi<Row>;
  getKey: (row: Row) => Key;
  snapshotListOptions?: unknown;
  snapshotEnabled?: boolean;
  /** Replace reconciles a complete snapshot; merge keeps paginated/windowed callers compatible. */
  snapshotMode?: "replace" | "merge";
  reconnectDelayMs?: number;
  gcTime?: number;
  rowUpdateMode?: "full" | "partial";
  onSubscriptionError?: (error: unknown) => void;
}

export function createTrailbaseRecordCollection<
  Row,
  Key extends string | number,
  Collection,
  Config = unknown,
>({
  createCollection,
  ...options
}: RecordCollectionOptions<Row, Key, Collection, Config>): Collection {
  return createCollection(trailbaseRecordCollectionOptions(options) as Config);
}

export function trailbaseRecordCollectionOptions<Row, Key extends string | number>({
  id,
  recordApi,
  getKey,
  snapshotListOptions = { pagination: { limit: 10 } },
  snapshotEnabled = true,
  snapshotMode = "replace",
  reconnectDelayMs = 3_000,
  gcTime = Number.POSITIVE_INFINITY,
  rowUpdateMode = "full",
  onSubscriptionError,
}: Omit<RecordCollectionOptions<Row, Key, unknown, unknown>, "createCollection">) {
  let cancelReader: (() => void) | undefined;
  let applySnapshotFromSync: ((rows: Row | Row[] | null | undefined) => void) | undefined;

  return {
    id,
    getKey,
    gcTime,
    sync: {
      rowUpdateMode,
      sync: ({ begin, collection, commit, markReady, write }: TanstackSyncContext<Row, Key>) => {
        let cancelled = false;
        let reader: ReadableStreamDefaultReader<TrailbaseEvent<Row>> | undefined;
        let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
        let wakeReconnect: (() => void) | undefined;
        const knownKeys = new Set<Key>();
        let subscriptionAbort: AbortController | undefined;
        const cancel = () => {
          subscriptionAbort?.abort();
          void reader?.cancel().catch(() => undefined);
        };

        const writeRow = (row: Row) => {
          const key = getKey(row);
          begin();
          write({ type: collection.has(key) ? "update" : "insert", value: row });
          commit();
          knownKeys.add(key);
        };
        const deleteKey = (key: Key) => {
          if (collection.has(key)) {
            begin();
            write({ type: "delete", key });
            commit();
          }
          knownKeys.delete(key);
        };
        const applyRows = (rows: Row | Row[] | null | undefined) => {
          if (!cancelled) for (const row of normalizeSnapshotRows(rows)) writeRow(row);
        };
        applySnapshotFromSync = applyRows;
        cancelReader = cancel;

        const listen = async () => {
          while (!cancelled) {
            try {
              subscriptionAbort = new AbortController();
              const stream = await recordApi.subscribe("*", { signal: subscriptionAbort.signal });
              if (cancelled) {
                await stream.cancel();
                return;
              }
              reader = stream.getReader();
              // Subscribe before fetching. The stream queues events until the
              // snapshot has committed, so a late list cannot overwrite them.
              if (snapshotEnabled) {
                const rows = await readCollectionSnapshot(recordApi, snapshotListOptions, snapshotMode, () => cancelled);
                if (cancelled) return;
                if (snapshotMode === "replace") {
                  const keys = new Set(rows.map(getKey));
                  for (const key of knownKeys) if (!keys.has(key)) deleteKey(key);
                }
                applyRows(rows);
              }
              if (cancelled) return;
              markReady();
              while (!cancelled) {
                const { done, value } = await reader.read();
                if (cancelled || done) break;
                if (value) applyTrailbaseEvent(value, { writeRow, deleteRow: (row) => deleteKey(getKey(row)) });
              }
            } catch (error) {
              if (!cancelled) onSubscriptionError?.(error);
            } finally {
              // A failed list must also close its subscription before retrying.
              try { await reader?.cancel(); } catch { /* stream may already be errored */ }
              try { reader?.releaseLock(); } catch { /* RN may release during cancellation */ }
              reader = undefined;
              subscriptionAbort?.abort();
              subscriptionAbort = undefined;
            }
            if (!cancelled) {
              await new Promise<void>((resolve) => {
                wakeReconnect = resolve;
                reconnectTimer = setTimeout(resolve, reconnectDelayMs);
              });
              wakeReconnect = undefined;
            }
          }
        };
        void listen();
        return {
          cleanup: () => {
            cancelled = true;
            clearTimeout(reconnectTimer);
            wakeReconnect?.();
            cancel();
            if (applySnapshotFromSync === applyRows) applySnapshotFromSync = undefined;
            if (cancelReader === cancel) cancelReader = undefined;
          },
        };
      },
    },
    utils: {
      applySnapshot: (rows: Row | Row[] | null | undefined) => {
        applySnapshotFromSync?.(rows);
      },
      cancel: () => {
        cancelReader?.();
      },
    },
  };
}

async function readCollectionSnapshot<Row>(
  api: TrailbaseRecordApi<Row>,
  options: unknown,
  mode: "replace" | "merge",
  cancelled: () => boolean,
): Promise<Row[]> {
  const opts = (options ?? {}) as { pagination?: { cursor?: string; offset?: number; limit?: number } };
  if (mode === "replace" && (opts.pagination?.cursor || opts.pagination?.offset)) {
    throw new Error("Snapshot replacement must start at the first page; use snapshotMode: merge for a window");
  }
  const rows: Row[] = [];
  const seen = new Set<string>();
  let pageOptions = opts;
  while (!cancelled()) {
    const page = await api.list(pageOptions);
    rows.push(...page.records);
    if (mode === "merge" || !page.cursor || page.records.length === 0) break;
    if (seen.has(page.cursor)) throw new Error("TrailBase snapshot returned a repeated pagination cursor");
    seen.add(page.cursor);
    pageOptions = { ...opts, pagination: { ...opts.pagination, cursor: page.cursor } };
  }
  return rows;
}

export function applyTrailbaseEvent<Row>(
  event: TrailbaseEvent<Row>,
  handlers: {
    writeRow: (row: Row) => void;
    deleteRow: (row: Row) => void;
  },
) {
  if ("Insert" in event) {
    handlers.writeRow(event.Insert);
  } else if ("Update" in event) {
    handlers.writeRow(event.Update);
  } else if ("Delete" in event) {
    handlers.deleteRow(event.Delete);
  }
}

export async function subscribeRecordEvents<Row>({
  apiBaseUrl,
  apiName,
  id,
  headers,
  getHeaders,
  fallback,
  signal,
  connectionTimeoutMs = 15_000,
  XMLHttpRequestImpl = globalThis.XMLHttpRequest,
}: {
  apiBaseUrl: string;
  apiName: string;
  id: RecordId | "*";
  headers?: Record<string, string>;
  getHeaders?: () => Record<string, string> | Promise<Record<string, string>>;
  fallback: () => Promise<ReadableStream<TrailbaseEvent<Row>>>;
  signal?: AbortSignal;
  connectionTimeoutMs?: number;
  XMLHttpRequestImpl?: typeof XMLHttpRequest;
}) {
  if (signal?.aborted) throw subscriptionAbortError();
  if (!XMLHttpRequestImpl) {
    return fallback();
  }
  if (!Number.isFinite(connectionTimeoutMs) || connectionTimeoutMs <= 0) {
    throw new RangeError("connectionTimeoutMs must be finite and positive");
  }

  let connected!: () => void;
  let connectionFailed!: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => {
    connected = resolve;
    connectionFailed = reject;
  });
  const stream = createTrailbaseXhrSseStream<TrailbaseEvent<Row>>({
    url: `${normalizeTrailBaseUrl(apiBaseUrl)}/api/records/v1/${apiName}/subscribe/${encodeRecordId(id)}`,
    headers,
    getHeaders,
    XMLHttpRequestImpl,
    onConnected: connected,
    onConnectionError: connectionFailed,
    signal,
  });
  const timeout = setTimeout(() => {
    connectionFailed(new Error("TrailBase SSE connection timed out"));
    void stream.cancel().catch(() => undefined);
  }, connectionTimeoutMs);
  try {
    await ready;
    return stream;
  } finally {
    clearTimeout(timeout);
  }
}

function subscriptionAbortError() {
  return Object.assign(new Error("TrailBase SSE subscription aborted"), { name: "AbortError" });
}

export function createTrailbaseXhrSseStream<T>({
  url,
  headers = {},
  getHeaders,
  XMLHttpRequestImpl = globalThis.XMLHttpRequest,
  errorMessage = "TrailBase SSE subscription failed",
  onConnected,
  onConnectionError,
  signal,
}: {
  url: string;
  headers?: Record<string, string>;
  getHeaders?: () => Record<string, string> | Promise<Record<string, string>>;
  XMLHttpRequestImpl?: typeof XMLHttpRequest;
  errorMessage?: string;
  onConnected?: () => void;
  onConnectionError?: (error: Error) => void;
  signal?: AbortSignal;
}) {
  let xhr: XMLHttpRequest | undefined;
  let closed = false;
  let removeAbortListener = () => {};

  return new ReadableStream<T>({
    start(controller) {
      const fail = (error: Error) => {
        if (closed) return;
        closed = true;
        removeAbortListener();
        xhr?.abort();
        onConnectionError?.(error);
        controller.error(error);
      };
      const abort = () => fail(subscriptionAbortError());
      signal?.addEventListener("abort", abort, { once: true });
      removeAbortListener = () => signal?.removeEventListener("abort", abort);
      if (signal?.aborted) { abort(); return; }
      if (!XMLHttpRequestImpl) {
        fail(new Error("XMLHttpRequest is required for XHR SSE streams"));
        return;
      }
      // Do not return the header promise from start: stream cancellation must
      // remain immediate even if a token/header provider never resolves.
      void (async () => {
        const resolvedHeaders = { ...headers, ...(getHeaders ? await getHeaders() : {}) };
        if (closed) return;
        xhr = new XMLHttpRequestImpl();
        const parser = createSseParser((event) => {
          if (!event.data.trim()) return;
          try { controller.enqueue(JSON.parse(event.data) as T); }
          catch { /* Ignore malformed heartbeat or partial application events. */ }
        });
        let responseOffset = 0;
        const close = () => {
          if (closed) return;
          closed = true;
          removeAbortListener();
          parser.close();
          controller.close();
        };
        xhr.onreadystatechange = () => {
          if (!xhr || closed) return;
          if (xhr.readyState >= 2 && xhr.status >= 200 && xhr.status < 300) onConnected?.();
          if (xhr.readyState === XMLHttpRequestImpl.LOADING || xhr.readyState === XMLHttpRequestImpl.DONE) {
            const chunk = xhr.responseText.slice(responseOffset);
            responseOffset = xhr.responseText.length;
            parser.push(chunk);
          }
          if (xhr.readyState === XMLHttpRequestImpl.DONE) {
            if (xhr.status < 200 || xhr.status >= 300) { fail(createXhrHttpError(xhr, errorMessage)); return; }
            close();
          }
        };
        xhr.onerror = () => fail(new Error(errorMessage));
        xhr.onabort = abort;
        xhr.open("GET", url, true);
        xhr.setRequestHeader("Accept", "text/event-stream");
        for (const [key, value] of Object.entries(resolvedHeaders)) xhr.setRequestHeader(key, value);
        xhr.send();
      })().catch((error) => fail(error instanceof Error ? error : new Error(String(error))));
    },
    cancel() {
      closed = true;
      removeAbortListener();
      xhr?.abort();
      xhr = undefined;
    },
  });
}

function createXhrHttpError(xhr: XMLHttpRequest, fallback: string) {
  const payload = parseJsonPayload(xhr.responseText);
  return new TrailBaseHttpError(normalizeTrailBaseError(payload, fallback), {
    status: xhr.status,
    statusText: xhr.statusText,
    payload,
  });
}

function parseJsonPayload(text: string) {
  if (!text.trim()) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function encodeRecordId(id: RecordId | "*") {
  return id === "*" ? "*" : encodeURIComponent(String(id));
}

export function delay(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function normalizeSnapshotRows<Row>(rows: Row | Row[] | null | undefined) {
  if (!rows) {
    return [];
  }
  return Array.isArray(rows) ? rows : [rows];
}

interface TanstackSyncContext<Row, Key extends string | number> {
  begin: () => void;
  collection: { has: (key: Key) => boolean };
  commit: () => void;
  markReady: () => void;
  write: (event: { type: "insert" | "update"; value: Row } | { type: "delete"; key: Key }) => void;
}
