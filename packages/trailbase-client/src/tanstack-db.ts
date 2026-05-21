import { createSseParser, normalizeTrailBaseUrl } from "./index";

export type RecordId = string | number;

export type TrailbaseEvent<Row> =
  | { Insert: Row }
  | { Update: Row }
  | { Delete: Row };

export interface TrailbaseRecordApi<Row> {
  list: (opts?: any) => Promise<{ records: Row[] }>;
  subscribe: (id: any) => Promise<ReadableStream<any>>;
  subscribeAll?: (opts?: any) => Promise<ReadableStream<any>>;
  [key: string]: unknown;
}

export interface XhrSseRecordApiOptions<Row> {
  apiBaseUrl: string;
  apiName: string;
  fallbackRecordApi: TrailbaseRecordApi<Row>;
  XMLHttpRequestImpl?: typeof XMLHttpRequest;
}

export function createTrailbaseRecordApiWithXhrSse<Row>({
  apiBaseUrl,
  apiName,
  fallbackRecordApi,
  XMLHttpRequestImpl = globalThis.XMLHttpRequest,
}: XhrSseRecordApiOptions<Row>): TrailbaseRecordApi<Row> {
  return new Proxy(fallbackRecordApi, {
    get(target, property, receiver) {
      if (property === "subscribe") {
        return (id: RecordId | "*") =>
          subscribeRecordEvents({
            apiBaseUrl,
            apiName,
            id,
            XMLHttpRequestImpl,
            fallback: () => target.subscribe(id),
          });
      }
      if (property === "subscribeAll") {
        return (opts?: { filters?: unknown[] }) =>
          (opts?.filters?.length ?? 0) > 0
            ? target.subscribeAll?.(opts) ?? target.subscribe("*")
            : subscribeRecordEvents({
                apiBaseUrl,
                apiName,
                id: "*",
                XMLHttpRequestImpl,
                fallback: () => target.subscribeAll?.(opts) ?? target.subscribe("*"),
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

        const writeRow = (row: Row) => {
          const key = getKey(row);
          begin();
          write({
            type: collection.has(key) ? "update" : "insert",
            value: row,
          });
          commit();
        };

        const deleteRow = (row: Row) => {
          const key = getKey(row);
          if (!collection.has(key)) {
            return;
          }
          begin();
          write({ type: "delete", key });
          commit();
        };

        applySnapshotFromSync = (rows) => {
          for (const row of normalizeSnapshotRows(rows)) {
            writeRow(row);
          }
        };

        const listen = async () => {
          while (!cancelled) {
            try {
              const stream = await recordApi.subscribe("*");
              if (cancelled) {
                return;
              }

              reader = stream.getReader();
              cancelReader = () => {
                void reader?.cancel().catch(() => undefined);
              };

              while (!cancelled) {
                const { done, value } = await reader.read();
                if (done || !value) {
                  break;
                }
                applyTrailbaseEvent(value, { writeRow, deleteRow });
              }
            } catch (error) {
              onSubscriptionError?.(error);
            } finally {
              cancelReader = undefined;
              try {
                reader?.releaseLock();
              } catch {
                // React Native streams can release locks while cancelling.
              }
              reader = undefined;
            }

            if (!cancelled) {
              await delay(reconnectDelayMs);
            }
          }
        };

        const loadSnapshot = async () => {
          try {
            if (snapshotEnabled) {
              const response = await recordApi.list(snapshotListOptions);
              if (!cancelled) {
                applySnapshotFromSync?.(response.records);
              }
            }
          } finally {
            markReady();
          }
        };

        void listen();
        void loadSnapshot();

        return {
          cleanup: () => {
            cancelled = true;
            applySnapshotFromSync = undefined;
            cancelReader?.();
            cancelReader = undefined;
            void reader?.cancel().catch(() => undefined);
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
  fallback,
  XMLHttpRequestImpl = globalThis.XMLHttpRequest,
}: {
  apiBaseUrl: string;
  apiName: string;
  id: RecordId | "*";
  fallback: () => Promise<ReadableStream<TrailbaseEvent<Row>>>;
  XMLHttpRequestImpl?: typeof XMLHttpRequest;
}) {
  if (!XMLHttpRequestImpl) {
    return fallback();
  }

  return createTrailbaseXhrSseStream<TrailbaseEvent<Row>>({
    url: `${normalizeTrailBaseUrl(apiBaseUrl)}/api/records/v1/${apiName}/subscribe/${encodeRecordId(id)}`,
    XMLHttpRequestImpl,
  });
}

export function createTrailbaseXhrSseStream<T>({
  url,
  XMLHttpRequestImpl = globalThis.XMLHttpRequest,
  errorMessage = "TrailBase SSE subscription failed",
}: {
  url: string;
  XMLHttpRequestImpl?: typeof XMLHttpRequest;
  errorMessage?: string;
}) {
  let xhr: XMLHttpRequest | undefined;
  let closed = false;

  return new ReadableStream<T>({
    start(controller) {
      if (!XMLHttpRequestImpl) {
        controller.error(new Error("XMLHttpRequest is required for XHR SSE streams"));
        return;
      }

      xhr = new XMLHttpRequestImpl();
      const parser = createSseParser((event) => {
        if (!event.data.trim()) {
          return;
        }
        try {
          controller.enqueue(JSON.parse(event.data) as T);
        } catch {
          // Ignore malformed heartbeat or partial application events.
        }
      });
      let responseOffset = 0;

      const close = () => {
        if (!closed) {
          closed = true;
          parser.close();
          controller.close();
        }
      };

      xhr.onreadystatechange = () => {
        if (!xhr) {
          return;
        }
        if (xhr.readyState === XMLHttpRequestImpl.LOADING) {
          const chunk = xhr.responseText.slice(responseOffset);
          responseOffset = xhr.responseText.length;
          parser.push(chunk);
        }
        if (xhr.readyState === XMLHttpRequestImpl.DONE) {
          const chunk = xhr.responseText.slice(responseOffset);
          responseOffset = xhr.responseText.length;
          parser.push(chunk);
          close();
        }
      };
      xhr.onerror = () => {
        if (!closed) {
          controller.error(new Error(errorMessage));
        }
      };
      xhr.onabort = close;
      xhr.open("GET", url, true);
      xhr.setRequestHeader("Accept", "text/event-stream");
      xhr.send();
    },
    cancel() {
      closed = true;
      xhr?.abort();
      xhr = undefined;
    },
  });
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
