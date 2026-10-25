import { describe, expect, test } from "bun:test";
import http from "node:http";
import { Readable } from "node:stream";
import { createTossMtlsHttpClient } from "@ait-kit/api-client";
import fixtures from "../../../fixtures/contracts/apps-in-toss.v1.json" with { type: "json" };
import {
  ANONYMOUS_AUTH_CODE_EXCHANGE_PATH,
  ANONYMOUS_KEY_VERIFY_ALIAS_PATH,
  ANONYMOUS_KEY_VERIFY_PATH,
  PROMOTION_REWARD_STATUS_PATH,
  PROXY_ENDPOINTS,
  TOSS_ANONYMOUS_KEY_VERIFY_PATH,
  createProxyServer,
  handleRequest,
} from "../src/core.mjs";

// The Rust guest constants, this proxy, and @ait-kit/api-client each define
// the internal route paths. The shared fixture's `routes` rows are the one
// list all three are checked against (Rust: tests/wire_contracts.rs).

const routes = new Map(fixtures.routes.map((route) => [route.id, route]));

// Synthetic stub-mode request bodies keyed by fixture route id.
const STUB_BODIES = {
  "mtls.request": { method: "GET", path: "/fixture" },
  "toss-login.complete": { authorizationCode: "fixture-code", referrer: "DEFAULT" },
  "toss-login.remove-by-user-key": { tossUserKey: "fixture-user", accessToken: "fixture-token" },
  "iap.order-status": { orderId: "fixture-order", sku: "fixture-coins" },
  "anonymous-key.verify": { anonKey: "fixture-anon" },
  "anonymous-key.verify.ait-kit": { anonKey: "fixture-anon" },
  "anonymous-key.exchange": { code: "fixture-code" },
  "promotion.reward.grant": { tossUserKey: "fixture-user" },
  "promotion.reward.prepare": { tossUserKey: "fixture-user" },
  "promotion.reward.execute": {
    tossUserKey: "fixture-user",
    providerTransactionKey: "fixture-key",
    promotionCode: "fixture-promotion",
    amount: 1,
  },
  "promotion.reward.status": {
    tossUserKey: "fixture-user",
    providerTransactionKey: "fixture-key",
    promotionCode: "fixture-promotion",
  },
  "smart-message.send": { tossUserKey: "fixture-user", templateSetCode: "fixture-template", context: {} },
  "smart-message.send-bulk": {
    templateSetCode: "fixture-template",
    contextList: [{ tossUserKey: "fixture-user", context: {} }],
  },
};

// Expected stub-mode results for every TossMtlsHttpClient method. The removed
// grant route's rejection comes from the fixture row instead.
const CLIENT_RESULTS = {
  health: { ok: true, mode: "stub" },
  genericMtlsRequest: { ok: true, status: 200, body: { ok: true } },
  tossLoginComplete: { ok: true, referrer: "DEFAULT" },
  tossLoginRemoveByUserKey: { ok: true, providerStatus: "REMOVED" },
  iapOrderStatus: { ok: true, orderId: "fixture-order", providerStatus: "PAYMENT_COMPLETED", sku: "fixture-coins" },
  anonKeyVerify: { ok: true, valid: true, mode: "stub" },
  promotionRewardGrant: undefined,
  promotionPrepareReward: { ok: true, providerTransactionKey: "stub-promotion-transaction-key" },
  promotionExecuteReward: { ok: true, result: "SUBMITTED", providerTransactionKey: "fixture-key" },
  promotionRewardStatus: { ok: true, providerTransactionKey: "fixture-key" },
  smartMessageSend: { ok: true, providerStatus: "SENT", msgCount: 1 },
  smartMessageBulkSend: { ok: true, providerStatus: "SENT", msgCount: 1 },
};

describe("shared route fixture", () => {
  test("route ids and paths are unique", () => {
    expect(routes.size).toBe(fixtures.routes.length);
    expect(new Set(fixtures.routes.map((route) => route.path)).size).toBe(fixtures.routes.length);
  });

  test("pins every @ait-kit/api-client PROXY_ENDPOINTS path", () => {
    for (const route of fixtures.routes.filter((row) => row.aitKitEndpoint)) {
      expect({ id: route.id, path: PROXY_ENDPOINTS[route.aitKitEndpoint] }).toEqual({ id: route.id, path: route.path });
    }
    const pinned = new Set(fixtures.routes.filter((row) => row.aitKitEndpoint).map((row) => row.path));
    expect(Object.entries(PROXY_ENDPOINTS).filter(([, path]) => !pinned.has(path))).toEqual([]);
  });

  test("proxy-owned path constants match the fixture", () => {
    expect(ANONYMOUS_KEY_VERIFY_PATH).toBe(routes.get("anonymous-key.verify").path);
    expect(ANONYMOUS_KEY_VERIFY_ALIAS_PATH).toBe(routes.get("anonymous-key.verify.ait-kit").path);
    expect(ANONYMOUS_AUTH_CODE_EXCHANGE_PATH).toBe(routes.get("anonymous-key.exchange").path);
    expect(PROMOTION_REWARD_STATUS_PATH).toBe(routes.get("promotion.reward.status").path);
  });

  test("every fixture route is served by the stub proxy", async () => {
    const postRoutes = fixtures.routes.filter((route) => route.method === "POST").map((route) => route.id);
    expect(Object.keys(STUB_BODIES).sort()).toEqual(postRoutes.sort());
    await withUpstream(async (upstreamBaseUrl) => {
      const config = { mode: "stub", internalToken: "fixture-token", upstreamBaseUrl };
      for (const route of fixtures.routes) {
        const res = await handleRequest(request(route.method, route.path, STUB_BODIES[route.id]), config);
        const expected = route.removed ?? { status: 200 };
        expect({ id: route.id, status: res.status, error: res.body.error })
          .toMatchObject({ id: route.id, status: expected.status, ...(route.removed ? { error: route.removed.error } : {}) });
        expect(res.body.error).not.toBe("NOT_FOUND");
      }
    });
  });
});

describe("@ait-kit/api-client parity", () => {
  test("every TossMtlsHttpClient method reaches a stub proxy route", async () => {
    await withUpstream(async (upstreamBaseUrl) => {
      const server = createProxyServer({ mode: "stub", internalToken: "fixture-token", upstreamBaseUrl });
      await withServer(server, async (baseUrl) => {
        const client = createTossMtlsHttpClient({ baseUrl, token: "fixture-token", timeoutMs: 5000 });
        expect(Object.keys(client).sort()).toEqual(Object.keys(CLIENT_RESULTS).sort());
        for (const [method, expected] of Object.entries(CLIENT_RESULTS)) {
          const route = fixtures.routes.find((row) => row.aitKitEndpoint === method);
          expect({ method, routed: Boolean(route) }).toEqual({ method, routed: true });
          const call = client[method](STUB_BODIES[route.id]);
          if (route.removed) {
            await expect(call).rejects.toMatchObject({
              status: route.removed.status,
              body: { ok: false, error: route.removed.error },
            });
          } else {
            expect({ method, result: await call }).toMatchObject({ method, result: expected });
          }
        }
      });
    });
  });

  test("both anonymous-key verify spellings run the same Toss verification", async () => {
    const upstreamPaths = [];
    const upstream = http.createServer((req, res) => {
      upstreamPaths.push(req.url);
      req.resume();
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ resultType: "SUCCESS", success: true }));
    });
    await withServer(upstream, async (upstreamBaseUrl) => {
      const config = { mode: "forward", internalToken: "fixture-token", upstreamBaseUrl };
      const verify = (path) => handleRequest(request("POST", path, { anonKey: "fixture-anon" }), config);
      const canonical = await verify(routes.get("anonymous-key.verify").path);
      const alias = await verify(routes.get("anonymous-key.verify.ait-kit").path);
      expect(canonical).toEqual({ status: 200, body: { ok: true, valid: true, resultType: "SUCCESS", mode: "forward" } });
      expect(alias).toEqual(canonical);
      expect(upstreamPaths).toEqual([TOSS_ANONYMOUS_KEY_VERIFY_PATH, TOSS_ANONYMOUS_KEY_VERIFY_PATH]);
    });
  });
});

function request(method, url, body = undefined) {
  const stream = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
  return Object.assign(stream, { method, url, headers: { authorization: "Bearer fixture-token" } });
}

// Plain-HTTP upstream for the generic relay, which forwards even in stub mode.
function withUpstream(fn) {
  const upstream = http.createServer((req, res) => {
    req.resume();
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  });
  return withServer(upstream, fn);
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
