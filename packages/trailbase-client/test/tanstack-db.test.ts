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
