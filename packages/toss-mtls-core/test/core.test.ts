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
const upstreamBaseUrl = "https://apps-in-toss-api.toss.im";

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
    const calls: MtlsCall[] = [];
    const core = createTossMtlsCore({
      mode: "forward",
      upstreamBaseUrl,
      mtlsClient: fakeMtlsClient(calls, () => jsonResponse({ ok: true }, 201, { "x-result": "ok" })),
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
        url: `${upstreamBaseUrl}/anything`,
        init: {
          method: "POST",
          headers: {
            accept: "application/json",
            "content-type": "application/json",
            "x-test": "keep-me",
            "x-toss-user-key": "toss-user",
          },
          body: JSON.stringify({ value: 1 }),
        },
        body: { value: 1 },
      },
    ]);
    expect(result).toEqual({
      ok: true,
      status: 201,
      headers: { "content-type": "application/json", "x-result": "ok" },
      body: { ok: true },
    });
  });

  test("Toss Login complete performs token exchange and user lookup", async () => {
    const calls: MtlsCall[] = [];
    const core = createTossMtlsCore({
      mode: "forward",
      upstreamBaseUrl,
      mtlsClient: fakeMtlsClient(calls, (url) => {
        if (new URL(url).pathname === TOSS_ENDPOINTS.loginGenerateToken) {
          return jsonResponse({
            resultType: "SUCCESS",
            success: {
              accessToken: "toss-access-token",
              refreshToken: "toss-refresh-token",
              tokenType: "Bearer",
              expiresIn: 3599,
              scope: "user_key user_name",
            },
          });
        }
        return jsonResponse({
          resultType: "SUCCESS",
          success: {
            userKey: "toss-user-key",
            scope: "user_key",
            agreedTerms: ["terms-1"],
          },
        });
      }),
    });

    const result = await core.tossLoginComplete({
      authorizationCode: "code",
      referrer: "SANDBOX",
    });

    expect(calls).toEqual([
      {
        url: `${upstreamBaseUrl}${TOSS_ENDPOINTS.loginGenerateToken}`,
        init: {
          method: "POST",
          headers: { accept: "application/json", "content-type": "application/json" },
          body: JSON.stringify({ authorizationCode: "code", referrer: "SANDBOX" }),
        },
        body: { authorizationCode: "code", referrer: "SANDBOX" },
      },
      {
        url: `${upstreamBaseUrl}${TOSS_ENDPOINTS.loginMe}`,
        init: {
          method: "GET",
          headers: { accept: "application/json", authorization: "Bearer toss-access-token" },
        },
        body: undefined,
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
      upstreamBaseUrl,
      mtlsClient: fakeMtlsClient([], () =>
        jsonResponse({
          resultType: "FAIL",
          error: {
            errorCode: "USER_KEY_NOT_FOUND",
            reason: "cannot unlink sensitive-user using expired-token",
          },
        }),
      ),
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

  test("mTLS client factory requires an explicit appId", async () => {
    const appIds: string[] = [];
    const mtlsClientFactory = {
      async forApp(appId: string) {
        appIds.push(appId);
        return fakeMtlsClient([], () => jsonResponse({ ok: true }));
      },
    };

    const core = createTossMtlsCore({
      mode: "forward",
      upstreamBaseUrl,
      appId: "app-a",
      mtlsClientFactory,
    });
    await core.genericMtlsRequest({ path: "/anything" });

    expect(appIds).toEqual(["app-a"]);
    const missingAppIdCore = createTossMtlsCore({
      mode: "forward",
      upstreamBaseUrl,
      mtlsClientFactory,
    });
    await expect(missingAppIdCore.genericMtlsRequest({ path: "/anything" })).rejects.toThrow(
      "appId is required when mtlsClientFactory is used",
    );
  });

  test("IAP order status retries transient provider states with injected sleep", async () => {
    const sleeps: number[] = [];
    let calls = 0;
    const core = createTossMtlsCore({
      mode: "forward",
      upstreamBaseUrl,
      iapOrderStatusMaxAttempts: 3,
      iapOrderStatusRetryDelayMs: 7,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      mtlsClient: {
        async request() {
          calls += 1;
          return jsonResponse({
            resultType: "SUCCESS",
            success: {
              orderId: "order-1",
              status: calls < 3 ? "PENDING" : "PAYMENT_COMPLETED",
            },
          });
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
    const calls: MtlsCall[] = [];
    const core = createTossMtlsCore({
      mode: "forward",
      upstreamBaseUrl,
      mtlsClient: fakeMtlsClient(calls, (url) => {
        if (new URL(url).pathname === TOSS_ENDPOINTS.promotionGetKey) {
          return jsonResponse({ resultType: "SUCCESS", success: { key: "promotion-key" } });
        }
        return jsonResponse({ resultType: "SUCCESS", success: "SUCCESS" });
      }),
    });

    const result = await core.promotionRewardGrant({
      amount: 50,
      promotionCode: "campaign-code",
      providerRequestId: "attendance-1",
      requestedAt: 123,
      tossUserKey: "toss-user",
    });

    expect(calls.map((call) => new URL(call.url).pathname)).toEqual([
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
    const calls: MtlsCall[] = [];
    const core = createTossMtlsCore({
      mode: "forward",
      upstreamBaseUrl,
      mtlsClient: fakeMtlsClient(calls, () =>
        jsonResponse({
          resultType: "SUCCESS",
          success: {
            result: {
              msgCount: 1,
              sentPushCount: 1,
              sentInboxCount: 0,
            },
          },
        }),
      ),
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

    expect(calls.map((call) => new URL(call.url).pathname)).toEqual([
      TOSS_ENDPOINTS.messageSend,
      TOSS_ENDPOINTS.messageBulkSend,
    ]);
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

interface MtlsCall {
  url: string;
  init: RequestInit;
  body: unknown;
}

function fakeMtlsClient(calls: MtlsCall[], handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  return {
    async request(url: string, init: RequestInit) {
      calls.push({ url, init, body: parseRequestBody(init.body) });
      return await handler(url, init);
    },
  };
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function parseRequestBody(body: unknown) {
  if (typeof body !== "string") return undefined;
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

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
