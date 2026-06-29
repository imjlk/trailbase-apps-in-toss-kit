import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  SMART_MESSAGE_BULK_MAX_CONTEXTS,
  TOSS_ENDPOINTS,
  createTossMtlsCore,
} from "../src/index.ts";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("toss-mtls-core", () => {
  test("src stays runtime-neutral", () => {
    const files = listSourceFiles(path.join(packageRoot, "src"));
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      expect(source).not.toContain("node:");
      expect(source).not.toContain("process.env");
    }
  });

  test("generic relay normalizes request and returns upstream details", async () => {
    const calls = [];
    const core = createTossMtlsCore({
      mode: "forward",
      transport: {
        async request(input) {
          calls.push(input);
          return { status: 201, headers: { "x-result": "ok" }, body: { ok: true } };
        },
      },
    });

    const result = await core.genericMtlsRequest({
      method: "post",
      path: "/anything",
      headers: { Host: "drop-me", "X-Test": "keep-me" },
      body: { value: 1 },
      tossUserKey: "toss-user",
    });

    expect(calls).toEqual([
      {
        method: "POST",
        path: "/anything",
        headers: { "x-test": "keep-me" },
        body: { value: 1 },
        tossUserKey: "toss-user",
      },
    ]);
    expect(result).toEqual({
      ok: true,
      status: 201,
      headers: { "x-result": "ok" },
      body: { ok: true },
    });
  });

  test("Toss Login complete performs token exchange and user lookup", async () => {
    const calls = [];
    const core = createTossMtlsCore({
      mode: "forward",
      transport: {
        async request(input) {
          calls.push(input);
          if (input.path === TOSS_ENDPOINTS.loginGenerateToken) {
            return {
              status: 200,
              body: {
                resultType: "SUCCESS",
                success: {
                  accessToken: "toss-access-token",
                  refreshToken: "toss-refresh-token",
                  tokenType: "Bearer",
                  expiresIn: 3599,
                  scope: "user_key user_name",
                },
              },
            };
          }
          return {
            status: 200,
            body: {
              resultType: "SUCCESS",
              success: {
                userKey: "toss-user-key",
                scope: "user_key",
                agreedTerms: ["terms-1"],
              },
            },
          };
        },
      },
    });

    const result = await core.tossLoginComplete({
      authorizationCode: "code",
      referrer: "SANDBOX",
    });

    expect(calls).toEqual([
      {
        method: "POST",
        path: TOSS_ENDPOINTS.loginGenerateToken,
        body: { authorizationCode: "code", referrer: "SANDBOX" },
      },
      {
        method: "GET",
        path: TOSS_ENDPOINTS.loginMe,
        headers: { authorization: "Bearer toss-access-token" },
      },
    ]);
    expect(result).toMatchObject({
      ok: true,
      userKey: "toss-user-key",
      referrer: "SANDBOX",
      scopes: ["user_key"],
      agreedTerms: ["terms-1"],
      accessToken: "toss-access-token",
      refreshToken: "toss-refresh-token",
      tokenType: "Bearer",
      expiresIn: 3599,
    });
  });

  test("unlink adapter redacts user key and access token from failures", async () => {
    const core = createTossMtlsCore({
      mode: "forward",
      transport: {
        async request() {
          return {
            status: 200,
            body: {
              resultType: "FAIL",
              error: {
                errorCode: "USER_KEY_NOT_FOUND",
                reason: "cannot unlink sensitive-user using expired-token",
              },
            },
          };
        },
      },
    });

    const result = await core.tossLoginRemoveByUserKey({
      userKey: "sensitive-user",
      accessToken: "Bearer expired-token",
    });

    expect(result).toMatchObject({
      ok: false,
      providerStatus: "FAILED",
      failureReason: "cannot unlink [redacted] using [redacted]",
      providerErrorCode: "USER_KEY_NOT_FOUND",
    });
  });

  test("IAP order status retries transient provider states with injected sleep", async () => {
    const sleeps = [];
    let calls = 0;
    const core = createTossMtlsCore({
      mode: "forward",
      iapOrderStatusMaxAttempts: 3,
      iapOrderStatusRetryDelayMs: 7,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      transport: {
        async request() {
          calls += 1;
          return {
            status: 200,
            body: {
              resultType: "SUCCESS",
              success: {
                orderId: "order-1",
                status: calls < 3 ? "PENDING" : "PAYMENT_COMPLETED",
              },
            },
          };
        },
      },
    });

    const result = await core.iapOrderStatus({ orderId: "order-1", tossUserKey: "toss-user" });

    expect(calls).toBe(3);
    expect(sleeps).toEqual([7, 7]);
    expect(result).toMatchObject({
      ok: true,
      orderId: "order-1",
      providerStatus: "PAYMENT_COMPLETED",
      attempts: 3,
    });
  });

  test("promotion grant executes get-key, execute, and result lookup", async () => {
    const calls = [];
    const core = createTossMtlsCore({
      mode: "forward",
      transport: {
        async request(input) {
          calls.push(input);
          if (input.path === TOSS_ENDPOINTS.promotionGetKey) {
            return { status: 200, body: { resultType: "SUCCESS", success: { key: "promotion-key" } } };
          }
          return { status: 200, body: { resultType: "SUCCESS", success: "SUCCESS" } };
        },
      },
    });

    const result = await core.promotionRewardGrant({
      amount: 50,
      promotionCode: "campaign-code",
      providerRequestId: "attendance-1",
      requestedAt: 123,
      tossUserKey: "toss-user",
    });

    expect(calls.map((call) => call.path)).toEqual([
      TOSS_ENDPOINTS.promotionGetKey,
      TOSS_ENDPOINTS.promotionExecute,
      TOSS_ENDPOINTS.promotionResult,
    ]);
    expect(result).toMatchObject({
      ok: true,
      providerRequestId: "attendance-1",
      providerStatus: "GRANTED",
      providerTransactionKey: "promotion-key",
      grantedAt: 123,
    });
  });

  test("Smart Message single and bulk normalize upstream responses", async () => {
    const calls = [];
    const core = createTossMtlsCore({
      mode: "forward",
      transport: {
        async request(input) {
          calls.push(input);
          return {
            status: 200,
            body: {
              resultType: "SUCCESS",
              success: {
                result: {
                  msgCount: 1,
                  sentPushCount: 1,
                  sentInboxCount: 0,
                },
              },
            },
          };
        },
      },
    });

    const single = await core.smartMessageSend({
      providerRequestId: "msg-1",
      requestedAt: 456,
      templateSetCode: "template",
      tossUserKey: "toss-user",
      context: { name: "Ada" },
    });
    const bulk = await core.smartMessageBulkSend({
      providerRequestId: "msg-2",
      requestedAt: 789,
      templateSetCode: "template",
      contextList: [{ userKey: "toss-user", context: { name: "Ada" } }],
    });

    expect(calls.map((call) => call.path)).toEqual([TOSS_ENDPOINTS.messageSend, TOSS_ENDPOINTS.messageBulkSend]);
    expect(single).toMatchObject({ ok: true, providerStatus: "SENT", msgCount: 1 });
    expect(bulk).toMatchObject({ ok: true, providerStatus: "SENT", msgCount: 1 });
  });

  test("Smart Message bulk enforces Toss recipient limit", async () => {
    const core = createTossMtlsCore({ mode: "stub" });
    await expect(
      core.smartMessageBulkSend({
        templateSetCode: "template",
        contextList: Array.from({ length: SMART_MESSAGE_BULK_MAX_CONTEXTS + 1 }, () => ({
          userKey: "toss-user",
          context: {},
        })),
      }),
    ).rejects.toThrow("contextList supports at most 2500 recipients");
  });
});

function listSourceFiles(dir: string): string[] {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = path.join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      files.push(...listSourceFiles(fullPath));
    } else if (/\.[cm]?tsx?$/.test(entry)) {
      files.push(fullPath);
    }
  }
  return files;
}
