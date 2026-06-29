import { describe, expect, test } from "bun:test";
import { PROXY_ENDPOINTS, createTossMtlsHttpClient } from "../src/index.ts";

describe("toss-mtls-client", () => {
  test("calls health without a request body", async () => {
    const calls = [];
    const client = createTossMtlsHttpClient({
      baseUrl: "http://proxy.local/",
      token: "secret",
      fetch: fakeFetch(calls, { ok: true, mode: "stub" }),
    });

    const result = await client.health();

    expect(result).toEqual({ ok: true, mode: "stub" });
    expect(calls).toEqual([
      {
        url: `http://proxy.local${PROXY_ENDPOINTS.health}`,
        method: "GET",
        headers: {
          accept: "application/json",
          authorization: "Bearer secret",
        },
        body: undefined,
      },
    ]);
  });

  test("posts adapter requests with bearer auth and JSON bodies", async () => {
    const calls = [];
    const client = createTossMtlsHttpClient({
      baseUrl: "http://proxy.local",
      token: "secret",
      fetch: fakeFetch(calls, { ok: true, providerStatus: "SENT" }),
    });

    const result = await client.smartMessageSend({ templateSetCode: "template", context: {} });

    expect(result).toEqual({ ok: true, providerStatus: "SENT" });
    expect(calls).toEqual([
      {
        url: `http://proxy.local${PROXY_ENDPOINTS.smartMessageSend}`,
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: "Bearer secret",
          "content-type": "application/json",
        },
        body: JSON.stringify({ templateSetCode: "template", context: {} }),
      },
    ]);
  });

  test("maps each public method to the existing proxy endpoint", async () => {
    const calls = [];
    const client = createTossMtlsHttpClient({
      baseUrl: "http://proxy.local",
      fetch: fakeFetch(calls, { ok: true }),
    });

    await client.genericMtlsRequest({});
    await client.tossLoginComplete({});
    await client.tossLoginRemoveByUserKey({});
    await client.iapOrderStatus({});
    await client.promotionRewardGrant({});
    await client.smartMessageBulkSend({ templateSetCode: "template", contextList: [] });

    expect(calls.map((call) => call.url.replace("http://proxy.local", ""))).toEqual([
      PROXY_ENDPOINTS.genericMtlRequest,
      PROXY_ENDPOINTS.tossLoginComplete,
      PROXY_ENDPOINTS.tossLoginRemoveByUserKey,
      PROXY_ENDPOINTS.iapOrderStatus,
      PROXY_ENDPOINTS.promotionRewardGrant,
      PROXY_ENDPOINTS.smartMessageBulkSend,
    ]);
  });

  test("throws on non-2xx proxy responses even when the body is empty or non-JSON", async () => {
    const client = createTossMtlsHttpClient({
      baseUrl: "http://proxy.local",
      fetch: async () =>
        new Response("", {
          status: 502,
          headers: { "content-type": "text/plain" },
        }),
    });

    await expect(client.health()).rejects.toMatchObject({
      status: 502,
      body: {},
    });
  });
});

function fakeFetch(calls, body) {
  return async (url, init = {}) => {
    calls.push({
      url,
      method: init.method,
      headers: init.headers,
      body: init.body,
    });
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
}
