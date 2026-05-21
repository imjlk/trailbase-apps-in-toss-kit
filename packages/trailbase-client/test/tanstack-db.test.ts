import { describe, expect, test } from "bun:test";
import {
  applyTrailbaseEvent,
  createTrailbaseRecordApiWithXhrSse,
  createTrailbaseRecordCollection,
  encodeRecordId,
  trailbaseRecordCollectionOptions,
} from "../src/tanstack-db";
import { createTrailbaseQueryClientOptions } from "../src/react-query";

describe("TanStack TrailBase adapters", () => {
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

  test("builds React Query defaults", () => {
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
