import { describe, expect, test } from "bun:test";
import {
  TrailBaseHttpError,
  createAnonymousHash,
  createSseParser,
  normalizeTrailBaseUrl,
  requestJson,
  resolveAnonymousHash,
} from "../src/index";

describe("TrailBase client utilities", () => {
  test("normalizes base URLs", () => {
    expect(normalizeTrailBaseUrl("https://example.com///")).toBe("https://example.com");
  });

  test("requests JSON and normalizes errors", async () => {
    await expect(
      requestJson("https://example.invalid/test", {
        fetchImpl: async () =>
          new Response(JSON.stringify({ error: { message: "nope" } }), {
            status: 400,
            statusText: "Bad Request",
          }),
      }),
    ).rejects.toThrow(TrailBaseHttpError);
  });

  test("stringifies JSON-like request bodies", async () => {
    let capturedBody;
    let capturedHeaders;
    const response = await requestJson<{ ok: boolean }>("https://example.invalid/test", {
      method: "POST",
      body: { hello: "world" },
      fetchImpl: async (_url, init) => {
        capturedBody = init?.body;
        capturedHeaders = init?.headers;
        return new Response(JSON.stringify({ ok: true }));
      },
    });

    expect(response).toEqual({ ok: true });
    expect(capturedBody).toBe(JSON.stringify({ hello: "world" }));
    expect(new Headers(capturedHeaders).get("content-type")).toBe("application/json");
  });

  test("leaves native request bodies alone", async () => {
    const body = new URLSearchParams({ hello: "world" });
    let capturedBody;
    let capturedHeaders;
    await requestJson("https://example.invalid/test", {
      method: "POST",
      body,
      fetchImpl: async (_url, init) => {
        capturedBody = init?.body;
        capturedHeaders = init?.headers;
        return new Response(JSON.stringify({ ok: true }));
      },
    });

    expect(capturedBody).toBe(body);
    expect(new Headers(capturedHeaders).get("content-type")).toBeNull();
  });

  test("parses SSE data frames", () => {
    const events = [];
    const parser = createSseParser((event) => events.push(event));
    parser.push("event: insert\ndata: {\"id\":1}\n\n");

    expect(events).toEqual([{ event: "insert", data: "{\"id\":1}", id: undefined, retry: undefined }]);
  });

  test("resolves anonymous hash through storage", async () => {
    const storage = new Map();
    const hash = await resolveAnonymousHash({
      storage: {
        getItem: (key) => storage.get(key) ?? null,
        setItem: (key, value) => storage.set(key, value),
      },
      create: () => "anon_test",
    });

    expect(hash).toBe("anon_test");
    expect(await resolveAnonymousHash({ storage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
    } })).toBe("anon_test");
  });

  test("creates random-looking anonymous hashes", () => {
    expect(createAnonymousHash({ prefix: "user" })).toMatch(/^user_[0-9a-f]{32}$/);
  });
});
