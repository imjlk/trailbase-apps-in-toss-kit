import { describe, expect, test } from "bun:test";
import {
  applyTrailbaseEvent,
  createCollection,
  createTrailbaseRecordApiWithXhrSse,
  createTrailbaseRecordCollection,
  createTrailbaseXhrSseStream,
  encodeRecordId,
  trailbaseRecordCollectionOptions,
  useLiveQuery,
} from "../src/tanstack-db";
import { TrailBaseHttpError } from "../src/index";
import { createTrailbaseQueryClientOptions } from "../src/tanstack-query";

describe("TanStack TrailBase adapters", () => {
  test("re-exports TanStack React DB primitives", () => {
    expect(typeof createCollection).toBe("function");
    expect(typeof useLiveQuery).toBe("function");
  });

  test("encodes record ids", () => {
    expect(encodeRecordId("*")).toBe("*");
    expect(encodeRecordId("a b")).toBe("a%20b");
  });

  test("applies TrailBase events", () => {
    const writes = [];
    const deletes = [];
    applyTrailbaseEvent(
      { Insert: { id: 1 } },
      {
        writeRow: (row) => writes.push(row),
        deleteRow: (row) => deletes.push(row),
      },
    );
    applyTrailbaseEvent(
      { Delete: { id: 2 } },
      {
        writeRow: (row) => writes.push(row),
        deleteRow: (row) => deletes.push(row),
      },
    );

    expect(writes).toEqual([{ id: 1 }]);
    expect(deletes).toEqual([{ id: 2 }]);
  });

  test("falls back to the official record API when XMLHttpRequest is unavailable", async () => {
    const stream = new ReadableStream();
    const fallbackRecordApi = {
      list: async () => ({ records: [] }),
      subscribe: async () => stream,
    };
    const api = createTrailbaseRecordApiWithXhrSse({
      apiBaseUrl: "http://localhost:4000",
      apiName: "items",
      fallbackRecordApi,
      XMLHttpRequestImpl: undefined,
    });

    expect(await api.subscribe("*")).toBe(stream);
  });

  test("passes headers to XHR SSE subscriptions", async () => {
    const Xhr = createFakeXhrClass({
      responseText: 'data: {"Insert":{"id":1}}\n\n',
    });
    const stream = createTrailbaseXhrSseStream({
      url: "http://localhost:4000/api/records/v1/items/subscribe/*",
      headers: { authorization: "Bearer static-token" },
      getHeaders: async () => ({ "x-session": "session-token" }),
      XMLHttpRequestImpl: Xhr as unknown as typeof XMLHttpRequest,
    });
    const reader = stream.getReader();

    expect(await reader.read()).toEqual({ done: false, value: { Insert: { id: 1 } } });
    expect(Xhr.instances[0].headers).toMatchObject({
      Accept: "text/event-stream",
      authorization: "Bearer static-token",
      "x-session": "session-token",
    });
  });

  test("turns XHR SSE HTTP failures into TrailBase errors", async () => {
    const Xhr = createFakeXhrClass({
      status: 403,
      statusText: "Forbidden",
      responseText: JSON.stringify({ error: { message: "no access" } }),
    });
    const stream = createTrailbaseXhrSseStream({
      url: "http://localhost:4000/api/records/v1/items/subscribe/*",
      XMLHttpRequestImpl: Xhr as unknown as typeof XMLHttpRequest,
    });
    const reader = stream.getReader();

    await expect(reader.read()).rejects.toMatchObject({
      name: "TrailBaseHttpError",
      status: 403,
      message: "no access",
    } satisfies Partial<TrailBaseHttpError>);
  });

  test("creates collection options with snapshot utils", () => {
    const recordApi = {
      list: async () => ({ records: [] }),
      subscribe: async () => new ReadableStream(),
    };

    const options = trailbaseRecordCollectionOptions({
      id: "items",
      recordApi,
      getKey: (row) => row.id,
    });

    expect(options.id).toBe("items");
    expect(options.utils).toHaveProperty("applySnapshot");
    expect(
      createTrailbaseRecordCollection({
        createCollection: (collectionOptions) => collectionOptions,
        id: "items",
        recordApi,
        getKey: (row) => row.id,
      }),
    ).toHaveProperty("sync");
  });

  test("builds TanStack Query defaults", () => {
    expect(
      createTrailbaseQueryClientOptions({
        defaultOptions: { queries: { staleTime: 10_000 } },
      }),
    ).toMatchObject({
      defaultOptions: {
        queries: {
          staleTime: 10_000,
          retry: 1,
        },
      },
    });
  });
});

function createFakeXhrClass({
  status = 200,
  statusText = "OK",
  responseText = "",
}: {
  status?: number;
  statusText?: string;
  responseText?: string;
}) {
  return class FakeXMLHttpRequest {
    static LOADING = 3;
    static DONE = 4;
    static instances: FakeXMLHttpRequest[] = [];

    headers: Record<string, string> = {};
    method = "";
    url = "";
    async = true;
    readyState = 0;
    status = status;
    statusText = statusText;
    responseText = "";
    onreadystatechange?: () => void;
    onerror?: () => void;
    onabort?: () => void;

    constructor() {
      FakeXMLHttpRequest.instances.push(this);
    }

    open(method: string, url: string, async: boolean) {
      this.method = method;
      this.url = url;
      this.async = async;
    }

    setRequestHeader(key: string, value: string) {
      this.headers[key] = value;
    }

    send() {
      this.readyState = FakeXMLHttpRequest.LOADING;
      this.responseText = responseText;
      this.onreadystatechange?.();
      this.readyState = FakeXMLHttpRequest.DONE;
      this.onreadystatechange?.();
    }

    abort() {
      this.onabort?.();
    }
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function eventually(check: () => boolean) {
  for (let i = 0; i < 100; i++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  expect(check()).toBe(true);
}

test("actual TanStack collection reconciles missed updates and deletes on reconnect", async () => {
  let subscription: ReadableStreamDefaultController<any>;
  let subscriptions = 0;
  let lists = 0;
  const collection = createCollection(trailbaseRecordCollectionOptions({
    id: "reconnect", getKey: (row: { id: number; value: string }) => row.id,
    reconnectDelayMs: 1,
    recordApi: {
      subscribe: async () => {
        subscriptions++;
        return new ReadableStream({ start(controller) { subscription = controller; } });
      },
      list: async () => ({ records: ++lists === 1
        ? [{ id: 1, value: "old" }, { id: 2, value: "deleted offline" }]
        : [{ id: 1, value: "new" }, { id: 3, value: "created offline" }] }),
    },
  }));
  try {
    await collection.preload();
    expect(collection.has(2)).toBe(true);
    subscription!.close();
    await eventually(() => lists === 2 && collection.has(3));
    expect(subscriptions).toBe(2);
    expect(collection.get(1)?.value).toBe("new");
    expect(collection.has(2)).toBe(false);
  } finally { await collection.cleanup(); }
});

test("events received during a paginated snapshot win after every page is loaded", async () => {
  const lastPage = deferred<{ records: { id: number; value: string }[] }>();
  let subscription: ReadableStreamDefaultController<any>;
  let lists = 0;
  const collection = createCollection(trailbaseRecordCollectionOptions({
    id: "snapshot-ordering", getKey: (row: { id: number; value: string }) => row.id,
    recordApi: {
      subscribe: async () => new ReadableStream({ start(controller) { subscription = controller; } }),
      list: async (options) => {
        lists++;
        if (lists === 1) return { records: [{ id: 1, value: "stale" }], cursor: "next" };
        expect(options.pagination.cursor).toBe("next");
        return lastPage.promise;
      },
    },
  }));
  try {
    const preload = collection.preload();
    await eventually(() => lists === 2);
    subscription!.enqueue({ Update: { id: 1, value: "live" } });
    subscription!.enqueue({ Delete: { id: 2, value: "deleted" } });
    lastPage.resolve({ records: [{ id: 2, value: "stale" }] });
    await preload;
    await eventually(() => collection.get(1)?.value === "live" && !collection.has(2));
    expect(lists).toBe(2);
  } finally { await collection.cleanup(); }
});

test("a failed snapshot cancels its stream, reports the error, and retries without marking ready", async () => {
  const errors: unknown[] = [];
  let cancelled = 0;
  let lists = 0;
  const collection = createCollection(trailbaseRecordCollectionOptions({
    id: "snapshot-failure", getKey: (row: { id: number }) => row.id,
    reconnectDelayMs: 1, onSubscriptionError: (error) => errors.push(error),
    recordApi: {
      subscribe: async () => new ReadableStream({ cancel() { cancelled++; } }),
      list: async () => {
        if (++lists === 1) throw new Error("list unavailable");
        return { records: [{ id: 1 }] };
      },
    },
  }));
  try {
    await collection.preload();
    expect(lists).toBe(2);
    expect(errors).toHaveLength(1);
    expect(cancelled).toBe(1);
    expect(collection.has(1)).toBe(true);
  } finally { await collection.cleanup(); }
});

test("cleanup cancels a subscription that resolves late without loading a snapshot", async () => {
  const pending = deferred<ReadableStream<any>>();
  let cancelled = 0;
  let lists = 0;
  const options = trailbaseRecordCollectionOptions({
    id: "late-stream", getKey: (row: { id: number }) => row.id,
    recordApi: {
      subscribe: () => pending.promise,
      list: async () => { lists++; return { records: [] }; },
    },
  });
  const sync = options.sync.sync({
    begin() {}, commit() {}, write() { throw new Error("write after cleanup"); },
    markReady() { throw new Error("ready after cleanup"); }, collection: { has: () => false },
  });
  sync.cleanup();
  pending.resolve(new ReadableStream({ cancel() { cancelled++; } }));
  await eventually(() => cancelled === 1);
  expect(lists).toBe(0);
});

test("cleanup suppresses a late snapshot and readiness callback", async () => {
  const snapshot = deferred<{ records: { id: number }[] }>();
  let lists = 0;
  let writes = 0;
  const options = trailbaseRecordCollectionOptions({
    id: "late-snapshot", getKey: (row: { id: number }) => row.id,
    recordApi: {
      subscribe: async () => new ReadableStream(),
      list: () => { lists++; return snapshot.promise; },
    },
  });
  const sync = options.sync.sync({
    begin() {}, commit() {}, write() { writes++; }, markReady() { writes++; },
    collection: { has: () => false },
  });
  await eventually(() => lists === 1);
  sync.cleanup();
  snapshot.resolve({ records: [{ id: 1 }] });
  await new Promise((resolve) => setTimeout(resolve, 5));
  expect(writes).toBe(0);
});

test("XHR subscription waits for response headers before allowing a snapshot", async () => {
  const Base = createFakeXhrClass({});
  class Xhr extends Base { override send() {} }
  const api = createTrailbaseRecordApiWithXhrSse({
    apiBaseUrl: "http://localhost:4000", apiName: "items",
    fallbackRecordApi: { list: async () => ({ records: [] }), subscribe: async () => new ReadableStream() },
    XMLHttpRequestImpl: Xhr as unknown as typeof XMLHttpRequest,
  });
  let resolved = false;
  const pending = api.subscribe("*").then((stream) => { resolved = true; return stream; });
  await eventually(() => Xhr.instances.length === 1);
  expect(resolved).toBe(false);
  Xhr.instances[0].readyState = 2;
  Xhr.instances[0].onreadystatechange?.();
  const stream = await pending;
  expect(resolved).toBe(true);
  await stream.cancel();
});
