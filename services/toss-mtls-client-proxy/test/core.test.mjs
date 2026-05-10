import { describe, expect, test } from "bun:test";
import http from "node:http";
import { Readable } from "node:stream";
import { PROXY_ENDPOINTS, TOSS_ENDPOINTS, createConfig, createProxyServer, handleRequest } from "../src/core.mjs";

describe("toss-mtls-client-proxy", () => {
  test("rejects unauthorized requests when token is configured", async () => {
    const req = request("GET", PROXY_ENDPOINTS.health);
    const res = await handleRequest(req, { mode: "stub", internalToken: "secret" });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("UNAUTHORIZED");
  });

  test("requires an internal token in forward mode", () => {
    expect(() =>
      createProxyServer({
        mode: "forward",
        internalToken: "",
        upstreamBaseUrl: "https://apps-in-toss-api.toss.im",
      }),
    ).toThrow("MTLS_PROXY_TOKEN is required in forward mode");
  });

  test("parses bounded runtime settings from environment", () => {
    const config = createConfig({
      MTLS_PROXY_MODE: "FORWARD",
      MTLS_PROXY_TOKEN: "token",
      MTLS_UPSTREAM_BASE_URL: "https://apps-in-toss-api.toss.im",
      MTLS_PROXY_REQUEST_BODY_LIMIT_BYTES: "123",
      MTLS_PROXY_UPSTREAM_BODY_LIMIT_BYTES: "456",
      MTLS_PROXY_UPSTREAM_TIMEOUT_MS: "789",
    });
    expect(config.mode).toBe("forward");
    expect(config.requestBodyLimitBytes).toBe(123);
    expect(config.upstreamBodyLimitBytes).toBe(456);
    expect(config.upstreamTimeoutMs).toBe(789);
  });

  test("returns deterministic stub login response", async () => {
    const req = request("POST", PROXY_ENDPOINTS.tossLoginComplete, {
      authorizationCode: "code",
      referrer: "sandbox",
    });
    const res = await handleRequest(req, { mode: "stub", internalToken: "" });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.userKey.startsWith("stub-login:")).toBe(true);
    expect(res.body.referrer).toBe("sandbox");
  });

  test("validates generic proxy path is relative", async () => {
    const req = request("POST", "/internal/mtls/request", {
      method: "POST",
      path: "https://example.com/anything",
      body: {},
    });
    await expect(
      handleRequest(req, {
        mode: "forward",
        internalToken: "",
        upstreamBaseUrl: "https://apps-in-toss-api.toss.im",
      }),
    ).rejects.toThrow("path must be a relative absolute path");
  });

  test("server returns sanitized 400 for invalid JSON", async () => {
    const server = createProxyServer({ mode: "stub", internalToken: "" });
    await withServer(server, async (baseUrl) => {
      const res = await fetch(`${baseUrl}${PROXY_ENDPOINTS.tossLoginComplete}`, {
        method: "POST",
        body: "{",
      });
      const body = await res.json();
      expect(res.status).toBe(400);
      expect(body.error).toBe("INVALID_JSON");
      expect(body.message).toBe("Invalid JSON");
    });
  });

  test("server rejects oversized request bodies", async () => {
    const server = createProxyServer({ mode: "stub", internalToken: "", requestBodyLimitBytes: 16 });
    await withServer(server, async (baseUrl) => {
      const res = await fetch(`${baseUrl}${PROXY_ENDPOINTS.tossLoginComplete}`, {
        method: "POST",
        body: JSON.stringify({ authorizationCode: "too-large" }),
      });
      const body = await res.json();
      expect(res.status).toBe(413);
      expect(body.error).toBe("REQUEST_BODY_TOO_LARGE");
    });
  });

  test("server returns 504 when upstream times out", async () => {
    const upstreamServer = http.createServer(() => {});
    await withServer(upstreamServer, async (upstreamBaseUrl) => {
      const server = createProxyServer({
        mode: "forward",
        internalToken: "secret",
        upstreamBaseUrl,
        upstreamTimeoutMs: 20,
      });
      await withServer(server, async (baseUrl) => {
        const res = await fetch(`${baseUrl}${PROXY_ENDPOINTS.genericMtlRequest}`, {
          method: "POST",
          headers: {
            authorization: "Bearer secret",
            "content-type": "application/json",
          },
          body: JSON.stringify({ method: "GET", path: "/slow" }),
        });
        const body = await res.json();
        expect(res.status).toBe(504);
        expect(body.error).toBe("UPSTREAM_TIMEOUT");
      });
    });
  });

  test("server rejects oversized upstream responses", async () => {
    const upstreamServer = http.createServer((_, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: "too-large" }));
    });
    await withServer(upstreamServer, async (upstreamBaseUrl) => {
      const server = createProxyServer({
        mode: "forward",
        internalToken: "secret",
        upstreamBaseUrl,
        upstreamBodyLimitBytes: 8,
      });
      await withServer(server, async (baseUrl) => {
        const res = await fetch(`${baseUrl}${PROXY_ENDPOINTS.genericMtlRequest}`, {
          method: "POST",
          headers: {
            authorization: "Bearer secret",
            "content-type": "application/json",
          },
          body: JSON.stringify({ method: "GET", path: "/large" }),
        });
        const body = await res.json();
        expect(res.status).toBe(502);
        expect(body.error).toBe("UPSTREAM_RESPONSE_TOO_LARGE");
      });
    });
  });

  test("stub promotion rewards do not require Toss upstream env", async () => {
    const req = request("POST", PROXY_ENDPOINTS.promotionRewardGrant, {
      providerRequestId: "smoke",
      requestedAt: 1,
    });
    const res = await handleRequest(req, { mode: "stub", internalToken: "" });
    expect(res.body.providerStatus).toBe("GRANTED");
    expect(res.body.providerRequestId).toBe("smoke");
  });

  test("stub iap order status returns payable status", async () => {
    const req = request("POST", PROXY_ENDPOINTS.iapOrderStatus, {
      orderId: "order-1",
      sku: "loo.credits.50",
    });
    const res = await handleRequest(req, { mode: "stub", internalToken: "" });
    expect(res.body.ok).toBe(true);
    expect(res.body.orderId).toBe("order-1");
    expect(res.body.sku).toBe("loo.credits.50");
    expect(res.body.providerStatus).toBe("PAYMENT_COMPLETED");
  });

  test("message adapter targets the Toss messenger API", () => {
    expect(TOSS_ENDPOINTS.messageSend).toBe("/api-partner/v1/apps-in-toss/messenger/send-message");
  });

  test("adapter routes use Apps in Toss feature names", () => {
    expect(PROXY_ENDPOINTS.tossLoginComplete).toBe("/internal/apps-in-toss/toss-login/complete");
    expect(PROXY_ENDPOINTS.iapOrderStatus).toBe("/internal/apps-in-toss/iap/order/status");
    expect(PROXY_ENDPOINTS.promotionRewardGrant).toBe("/internal/apps-in-toss/promotion/reward/grant");
    expect(PROXY_ENDPOINTS.smartMessageSend).toBe("/internal/apps-in-toss/smart-message/send");
  });
});

function request(method, url, body = undefined, headers = {}) {
  const stream = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
  stream.method = method;
  stream.url = url;
  stream.headers = headers;
  return stream;
}

async function withServer(server, fn) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  try {
    return await fn(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}
