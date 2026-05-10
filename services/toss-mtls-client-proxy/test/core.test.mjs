import { describe, expect, test } from "bun:test";
import { Readable } from "node:stream";
import { PROXY_ENDPOINTS, TOSS_ENDPOINTS, handleRequest } from "../src/core.mjs";

describe("toss-mtls-client-proxy", () => {
  test("rejects unauthorized requests when token is configured", async () => {
    const req = request("GET", PROXY_ENDPOINTS.health);
    const res = await handleRequest(req, { mode: "stub", internalToken: "secret" });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("UNAUTHORIZED");
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
