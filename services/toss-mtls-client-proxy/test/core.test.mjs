import { describe, expect, test } from "bun:test";
import http from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import {
  PROXY_ENDPOINTS,
  SMART_MESSAGE_BULK_MAX_CONTEXTS,
  TOSS_ENDPOINTS,
  createConfig,
  createProxyServer,
  handleRequest,
} from "../src/core.mjs";

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
      MTLS_PROXY_IAP_ORDER_STATUS_MAX_ATTEMPTS: "2",
      MTLS_PROXY_IAP_ORDER_STATUS_RETRY_DELAY_MS: "0",
      MTLS_PROXY_DEBUG: "true",
    });
    expect(config.mode).toBe("forward");
    expect(config.requestBodyLimitBytes).toBe(123);
    expect(config.upstreamBodyLimitBytes).toBe(456);
    expect(config.upstreamTimeoutMs).toBe(789);
    expect(config.iapOrderStatusMaxAttempts).toBe(2);
    expect(config.iapOrderStatusRetryDelayMs).toBe(0);
    expect(config.debug).toBe(true);
  });

  test("detects Toss console certificate filenames from the mounted cert directory", () => {
    const certDir = mkdtempSync(path.join(tmpdir(), "toss-mtls-"));
    try {
      writeFileSync(path.join(certDir, "sample-service_public.crt"), "cert");
      writeFileSync(path.join(certDir, "sample-service_private.key"), "key");

      const config = createConfig({
        MTLS_PROXY_MODE: "FORWARD",
        MTLS_PROXY_TOKEN: "token",
        MTLS_UPSTREAM_BASE_URL: "https://apps-in-toss-api.toss.im",
        MTLS_CERT_DIR: certDir,
      });

      expect(config.clientCertPath).toBe(path.join(certDir, "sample-service_public.crt"));
      expect(config.clientKeyPath).toBe(path.join(certDir, "sample-service_private.key"));
    } finally {
      rmSync(certDir, { recursive: true, force: true });
    }
  });

  test("prefers a complete Toss certificate pair over explicit fallback paths", () => {
    const certDir = mkdtempSync(path.join(tmpdir(), "toss-mtls-"));
    try {
      writeFileSync(path.join(certDir, "sample-service_public.crt"), "cert");
      writeFileSync(path.join(certDir, "sample-service_private.key"), "key");

      const config = createConfig({
        MTLS_CERT_DIR: certDir,
        MTLS_CLIENT_CERT_PATH: "/custom/client.crt",
        MTLS_CLIENT_KEY_PATH: "/custom/client.key",
      });

      expect(config.clientCertPath).toBe(path.join(certDir, "sample-service_public.crt"));
      expect(config.clientKeyPath).toBe(path.join(certDir, "sample-service_private.key"));
    } finally {
      rmSync(certDir, { recursive: true, force: true });
    }
  });

  test("uses explicit certificate paths when no complete Toss pair is available", () => {
    const certDir = mkdtempSync(path.join(tmpdir(), "toss-mtls-"));
    try {
      writeFileSync(path.join(certDir, "sample-service_public.crt"), "cert");

      const config = createConfig({
        MTLS_CERT_DIR: certDir,
        MTLS_CLIENT_CERT_PATH: "/custom/client.crt",
        MTLS_CLIENT_KEY_PATH: "/custom/client.key",
      });

      expect(config.clientCertPath).toBe("/custom/client.crt");
      expect(config.clientKeyPath).toBe("/custom/client.key");
    } finally {
      rmSync(certDir, { recursive: true, force: true });
    }
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

  test("preserves SDK sandbox referrer casing", async () => {
    const req = request("POST", PROXY_ENDPOINTS.tossLoginComplete, {
      authorizationCode: "code",
      referrer: "SANDBOX",
    });
    const res = await handleRequest(req, { mode: "stub", internalToken: "" });
    expect(res.body.referrer).toBe("SANDBOX");
  });

  test("forward login failure reads Toss error reason instead of object text", async () => {
    const upstreamServer = http.createServer((req, res) => {
      req.resume();
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          resultType: "FAIL",
          error: {
            errorCode: "OAUTH_ISSUE_TOKEN_ERROR",
            reason: "invalid_grant from Toss",
          },
        }),
      );
    });
    await withServer(upstreamServer, async (upstreamBaseUrl) => {
      const req = request(
        "POST",
        PROXY_ENDPOINTS.tossLoginComplete,
        {
          authorizationCode: "code",
          referrer: "sandbox",
        },
        { authorization: "Bearer secret" },
      );
      const res = await handleRequest(req, {
        mode: "forward",
        internalToken: "secret",
        upstreamBaseUrl,
      });
      expect(res.body.ok).toBe(false);
      expect(res.body.error).toBe("TOKEN_EXCHANGE_FAILED");
      expect(res.body.failureReason).toBe("invalid_grant from Toss");
    });
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

  test("forward promotion rewards can use request-level campaign values", async () => {
    const calls = [];
    const upstreamServer = http.createServer((req, res) => {
      readRequestJson(req).then((body) => {
        calls.push({
          body,
          path: req.url,
          tossUserKey: req.headers["x-toss-user-key"],
        });
        res.writeHead(200, { "content-type": "application/json" });
        if (req.url === TOSS_ENDPOINTS.promotionGetKey) {
          res.end(JSON.stringify({ resultType: "SUCCESS", success: { key: "promotion-key" } }));
          return;
        }
        if (req.url === TOSS_ENDPOINTS.promotionExecute) {
          res.end(JSON.stringify({ resultType: "SUCCESS", success: { key: "promotion-key" } }));
          return;
        }
        res.end(JSON.stringify({ resultType: "SUCCESS", success: "SUCCESS" }));
      });
    });
    await withServer(upstreamServer, async (upstreamBaseUrl) => {
      const req = request(
        "POST",
        PROXY_ENDPOINTS.promotionRewardGrant,
        {
          amount: 50,
          promotionCode: "campaign-from-db",
          providerRequestId: "attendance-1",
          tossUserKey: "toss-user-1",
        },
        { authorization: "Bearer secret" },
      );
      const res = await handleRequest(req, {
        mode: "forward",
        internalToken: "secret",
        upstreamBaseUrl,
      });
      expect(res.body.providerStatus).toBe("GRANTED");
      expect(calls.map((call) => call.path)).toEqual([
        TOSS_ENDPOINTS.promotionGetKey,
        TOSS_ENDPOINTS.promotionExecute,
        TOSS_ENDPOINTS.promotionResult,
      ]);
      expect(calls[1].body).toEqual({
        amount: 50,
        key: "promotion-key",
        promotionCode: "campaign-from-db",
      });
      expect(calls.every((call) => call.tossUserKey === "toss-user-1")).toBe(true);
    });
  });

  test("forward promotion execute failures include provider error codes", async () => {
    const upstreamServer = http.createServer((req, res) => {
      req.resume();
      res.writeHead(200, { "content-type": "application/json" });
      if (req.url === TOSS_ENDPOINTS.promotionGetKey) {
        res.end(JSON.stringify({ resultType: "SUCCESS", success: { key: "promotion-key" } }));
        return;
      }
      res.end(
        JSON.stringify({
          error: {
            errorCode: "4112",
            message: "프로모션 머니가 부족해요",
          },
          resultType: "FAIL",
        }),
      );
    });
    await withServer(upstreamServer, async (upstreamBaseUrl) => {
      const req = request(
        "POST",
        PROXY_ENDPOINTS.promotionRewardGrant,
        {
          amount: 50,
          promotionCode: "campaign-from-db",
          providerRequestId: "attendance-1",
          tossUserKey: "toss-user-1",
        },
        { authorization: "Bearer secret" },
      );
      const res = await handleRequest(req, {
        mode: "forward",
        internalToken: "secret",
        upstreamBaseUrl,
      });
      expect(res.body.providerStatus).toBe("PROMOTION_EXECUTE_FAILED");
      expect(res.body.providerErrorCode).toBe("4112");
      expect(res.body.failureReason).toBe("4112");
    });
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

  test("forward iap order status falls back to requested sku when Toss omits sku", async () => {
    const upstreamServer = http.createServer((req, res) => {
      req.resume();
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          resultType: "SUCCESS",
          success: {
            orderId: "order-1",
            status: "PAYMENT_COMPLETED",
          },
        }),
      );
    });
    await withServer(upstreamServer, async (upstreamBaseUrl) => {
      const req = request(
        "POST",
        PROXY_ENDPOINTS.iapOrderStatus,
        {
          orderId: "order-1",
          sku: "loo.credits.50",
          tossUserKey: "toss-user-1",
        },
        { authorization: "Bearer secret" },
      );
      const res = await handleRequest(req, {
        mode: "forward",
        internalToken: "secret",
        upstreamBaseUrl,
      });
      expect(res.body.ok).toBe(true);
      expect(res.body.orderId).toBe("order-1");
      expect(res.body.sku).toBe("loo.credits.50");
      expect(res.body.providerStatus).toBe("PAYMENT_COMPLETED");
    });
  });

  test("forward iap order status retries transient provider statuses", async () => {
    let hitCount = 0;
    const upstreamServer = http.createServer((req, res) => {
      req.resume();
      hitCount += 1;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          resultType: "SUCCESS",
          success: {
            orderId: "order-1",
            status: hitCount === 1 ? "ORDER_IN_PROGRESS" : "PAYMENT_COMPLETED",
          },
        }),
      );
    });
    await withServer(upstreamServer, async (upstreamBaseUrl) => {
      const req = request(
        "POST",
        PROXY_ENDPOINTS.iapOrderStatus,
        {
          orderId: "order-1",
          sku: "loo.credits.50",
          tossUserKey: "toss-user-1",
        },
        { authorization: "Bearer secret" },
      );
      const res = await handleRequest(req, {
        mode: "forward",
        internalToken: "secret",
        upstreamBaseUrl,
        iapOrderStatusMaxAttempts: 2,
        iapOrderStatusRetryDelayMs: 0,
      });
      expect(hitCount).toBe(2);
      expect(res.body.ok).toBe(true);
      expect(res.body.sku).toBe("loo.credits.50");
      expect(res.body.providerStatus).toBe("PAYMENT_COMPLETED");
      expect(res.body.attempts).toBe(2);
    });
  });

  test("forward message normalizes official Toss success response counts", async () => {
    let upstreamBody;
    let upstreamUserKey;
    const upstreamServer = http.createServer(async (req, res) => {
      upstreamUserKey = req.headers["x-toss-user-key"];
      upstreamBody = await readRequestJson(req);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          resultType: "SUCCESS",
          result: {
            msgCount: 1,
            sentPushCount: 1,
            sentInboxCount: 0,
            detail: {
              sentPush: [{ contentId: "toss:PUSH:1" }],
              sentInbox: [],
            },
            fail: {
              sentPush: [],
              sentInbox: [],
            },
          },
        }),
      );
    });
    await withServer(upstreamServer, async (upstreamBaseUrl) => {
      const req = request(
        "POST",
        PROXY_ENDPOINTS.smartMessageSend,
        {
          providerRequestId: "msg-1",
          templateSetCode: "reward_result",
          context: { point: "100" },
          tossUserKey: "toss-user-1",
          requestedAt: 1234,
        },
        { authorization: "Bearer secret" },
      );
      const res = await handleRequest(req, {
        mode: "forward",
        internalToken: "secret",
        upstreamBaseUrl,
      });
      expect(upstreamUserKey).toBe("toss-user-1");
      expect(upstreamBody.tossUserKey).toBeUndefined();
      expect(res.body.ok).toBe(true);
      expect(res.body.providerStatus).toBe("SENT");
      expect(res.body.resultType).toBe("SUCCESS");
      expect(res.body.msgCount).toBe(1);
      expect(res.body.sentPushCount).toBe(1);
      expect(res.body.sentInboxCount).toBe(0);
      expect(res.body.contentIds).toEqual(["toss:PUSH:1"]);
    });
  });

  test("forward bulk message targets Toss bulk API with sanitized context list", async () => {
    let upstreamBody;
    let upstreamUserKey;
    let upstreamPath;
    const upstreamServer = http.createServer(async (req, res) => {
      upstreamPath = req.url;
      upstreamUserKey = req.headers["x-toss-user-key"];
      upstreamBody = await readRequestJson(req);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          resultType: "SUCCESS",
          success: {
            msgCount: 2,
            sentPushCount: 2,
            sentInboxCount: 0,
            detail: {
              sentPush: [{ contentId: "toss:PUSH:1" }, { contentId: "toss:PUSH:2" }],
              sentInbox: [],
            },
            fail: {
              sentPush: [],
              sentInbox: [],
            },
          },
        }),
      );
    });
    await withServer(upstreamServer, async (upstreamBaseUrl) => {
      const req = request(
        "POST",
        PROXY_ENDPOINTS.smartMessageBulkSend,
        {
          providerRequestId: "bulk-1",
          templateSetCode: "mission_daily_status_v1",
          purpose: "FUNCTIONAL",
          contextList: [
            {
              messageId: "message-1",
              userId: "user-1",
              idempotencyKey: "idem-1",
              tossUserKey: "toss-user-1",
              context: { correctCount: 1 },
            },
            {
              messageId: "message-2",
              userId: "user-2",
              idempotencyKey: "idem-2",
              userKey: "toss-user-2",
              context: { correctCount: 2 },
            },
          ],
          requestedAt: 1234,
        },
        { authorization: "Bearer secret" },
      );
      const res = await handleRequest(req, {
        mode: "forward",
        internalToken: "secret",
        upstreamBaseUrl,
      });

      expect(upstreamPath).toBe(TOSS_ENDPOINTS.messageBulkSend);
      expect(upstreamUserKey).toBeUndefined();
      expect(upstreamBody).toEqual({
        templateSetCode: "mission_daily_status_v1",
        contextList: [
          { userKey: "toss-user-1", context: { correctCount: 1 } },
          { userKey: "toss-user-2", context: { correctCount: 2 } },
        ],
      });
      expect(res.body.ok).toBe(true);
      expect(res.body.providerStatus).toBe("SENT");
      expect(res.body.resultType).toBe("SUCCESS");
      expect(res.body.msgCount).toBe(2);
      expect(res.body.sentPushCount).toBe(2);
      expect(res.body.contentIds).toEqual(["toss:PUSH:1", "toss:PUSH:2"]);
    });
  });

  test("bulk message rejects context lists over Toss limit", async () => {
    const req = request("POST", PROXY_ENDPOINTS.smartMessageBulkSend, {
      providerRequestId: "bulk-too-large",
      templateSetCode: "mission_daily_status_v1",
      contextList: Array.from({ length: SMART_MESSAGE_BULK_MAX_CONTEXTS + 1 }, (_, index) => ({
        userKey: `toss-user-${index}`,
        context: {},
      })),
    });

    await expect(handleRequest(req, { mode: "stub", internalToken: "" })).rejects.toThrow(
      "contextList supports at most 2500 recipients",
    );
  });

  test("forward message maps official Toss failure response", async () => {
    const upstreamServer = http.createServer((req, res) => {
      req.resume();
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          resultType: "FAIL",
          error: {
            errorCode: "INVALID_TEMPLATE",
            reason: "template is not approved",
          },
        }),
      );
    });
    await withServer(upstreamServer, async (upstreamBaseUrl) => {
      const req = request(
        "POST",
        PROXY_ENDPOINTS.smartMessageSend,
        {
          providerRequestId: "msg-2",
          templateSetCode: "reward_result",
          context: {},
          tossUserKey: "toss-user-1",
        },
        { authorization: "Bearer secret" },
      );
      const res = await handleRequest(req, {
        mode: "forward",
        internalToken: "secret",
        upstreamBaseUrl,
      });
      expect(res.body.ok).toBe(false);
      expect(res.body.providerStatus).toBe("FAILED");
      expect(res.body.resultType).toBe("FAIL");
      expect(res.body.providerErrorCode).toBe("INVALID_TEMPLATE");
      expect(res.body.failureReason).toBe("template is not approved");
    });
  });

  test("forward message keeps partial delivery as sent while exposing reach failures", async () => {
    const upstreamServer = http.createServer((req, res) => {
      req.resume();
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          resultType: "SUCCESS",
          result: {
            msgCount: 1,
            sentPushCount: 1,
            sentInboxCount: 0,
            detail: {
              sentPush: [{ contentId: "toss:PUSH:2" }],
              sentInbox: [],
            },
            fail: {
              sentPush: [],
              sentInbox: [{ contentId: "toss:INBOX:2", reachFailReason: "사용자 알림함 도달 실패" }],
            },
          },
        }),
      );
    });
    await withServer(upstreamServer, async (upstreamBaseUrl) => {
      const req = request(
        "POST",
        PROXY_ENDPOINTS.smartMessageSend,
        {
          providerRequestId: "msg-3",
          templateSetCode: "reward_result",
          context: {},
          tossUserKey: "toss-user-1",
        },
        { authorization: "Bearer secret" },
      );
      const res = await handleRequest(req, {
        mode: "forward",
        internalToken: "secret",
        upstreamBaseUrl,
      });
      expect(res.body.ok).toBe(true);
      expect(res.body.providerStatus).toBe("SENT");
      expect(res.body.failureReason).toBe("사용자 알림함 도달 실패");
      expect(res.body.failures).toEqual([
        {
          channel: "sentInbox",
          contentId: "toss:INBOX:2",
          reachFailReason: "사용자 알림함 도달 실패",
        },
      ]);
    });
  });

  test("forward message infers failed passthrough status when ok is omitted", async () => {
    const upstreamServer = http.createServer((req, res) => {
      req.resume();
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          providerRequestId: "msg-4",
          providerStatus: "FAILED",
          failureReason: "provider rejected message",
        }),
      );
    });
    await withServer(upstreamServer, async (upstreamBaseUrl) => {
      const req = request(
        "POST",
        PROXY_ENDPOINTS.smartMessageSend,
        {
          providerRequestId: "msg-4",
          templateSetCode: "reward_result",
          context: {},
          tossUserKey: "toss-user-1",
        },
        { authorization: "Bearer secret" },
      );
      const res = await handleRequest(req, {
        mode: "forward",
        internalToken: "secret",
        upstreamBaseUrl,
      });
      expect(res.body.ok).toBe(false);
      expect(res.body.providerStatus).toBe("FAILED");
      expect(res.body.failureReason).toBe("provider rejected message");
    });
  });

  test("message adapter targets the Toss messenger API", () => {
    expect(TOSS_ENDPOINTS.messageSend).toBe("/api-partner/v1/apps-in-toss/messenger/send-message");
    expect(TOSS_ENDPOINTS.messageBulkSend).toBe("/api-partner/v1/apps-in-toss/messenger/send-bulk-message");
  });

  test("adapter routes use Apps in Toss feature names", () => {
    expect(PROXY_ENDPOINTS.tossLoginComplete).toBe("/internal/apps-in-toss/toss-login/complete");
    expect(PROXY_ENDPOINTS.iapOrderStatus).toBe("/internal/apps-in-toss/iap/order/status");
    expect(PROXY_ENDPOINTS.promotionRewardGrant).toBe("/internal/apps-in-toss/promotion/reward/grant");
    expect(PROXY_ENDPOINTS.smartMessageSend).toBe("/internal/apps-in-toss/smart-message/send");
    expect(PROXY_ENDPOINTS.smartMessageBulkSend).toBe("/internal/apps-in-toss/smart-message/send-bulk");
  });
});

function request(method, url, body = undefined, headers = {}) {
  const stream = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
  stream.method = method;
  stream.url = url;
  stream.headers = headers;
  return stream;
}

function readRequestJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
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
