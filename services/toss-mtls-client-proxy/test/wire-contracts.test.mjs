import { expect, test } from "bun:test";
import http from "node:http";
import { Readable } from "node:stream";
import fixtures from "../../../fixtures/contracts/apps-in-toss.v1.json" with { type: "json" };
import { createProxyServer, handleRequest } from "../src/http-server.mjs";

const routePath = (id) => fixtures.routes.find((route) => route.id === id).path;

function request(url, body) {
  const req = Readable.from([Buffer.from(JSON.stringify(body))]);
  return Object.assign(req, { method: "POST", url, headers: { authorization: "Bearer fixture-token" } });
}

test("shared IAP wire fixtures cover SKU evidence without masking provider failures", async () => {
  expect(fixtures.schemaVersion).toBe(1);
  for (const row of fixtures.iap) {
    // api-core 0.3 receives the request sku as a caller expectation (never
    // provider evidence); the proxy must keep it out of every response
    // unless the core (provider) supplied the sku itself.
    const core = { iapOrderStatus: async () => structuredClone(row.coreResponse) };
    const response = await handleRequest(request(routePath("iap.order-status"), { orderId: "fixture-order", sku: "requested-sku" }),
      { mode: "forward", internalToken: "fixture-token" }, core);
    expect(response.status).toBe(200);
    expect(response.body).toEqual(row.proxyResponse);
  }
});

test("shared message wire fixtures retain partial delivery and both failure field spellings", async () => {
  for (const row of fixtures.message) {
    const core = { smartMessageSend: async () => structuredClone(row.coreResponse) };
    const response = await handleRequest(request(routePath("smart-message.send"), {}),
      { mode: "forward", internalToken: "fixture-token" }, core);
    expect(response.status).toBe(200);
    expect(response.body).toEqual(row.proxyResponse);
  }
});

test("shared promotion wire fixtures pass through prepare, execute, and status verbatim", async () => {
  // The proxy never reclassifies promotion outcomes: a failure envelope stays a
  // failure even beside a success status, and the Rust ledger owns the mapping.
  const core = (row) => ({
    promotionPrepareReward: async () => structuredClone(row.response),
    promotionExecuteReward: async () => structuredClone(row.response),
    promotionRewardStatus: async () => structuredClone(row.response),
  });
  const routes = ["promotion.reward.prepare", "promotion.reward.execute", "promotion.reward.status"];
  for (const row of fixtures.promotion) {
    for (const id of routes) {
      const response = await handleRequest(request(routePath(id), { providerTransactionKey: "fixture-key" }),
        { mode: "forward", internalToken: "fixture-token" }, core(row));
      expect({ id: row.id, route: id, status: response.status, body: response.body })
        .toEqual({ id: row.id, route: id, status: 200, body: row.response });
    }
  }
});

test("shared promotion transport-failure fixture matches the proxy prepare timeout envelope", async () => {
  // Execute and status fold transport failures into UNKNOWN results; prepare
  // surfaces the proxy's own 504 envelope that the Rust ledger keeps pending.
  const row = fixtures.promotion.find((candidate) => candidate.id === "proxy-transport-failure");
  const upstream = http.createServer((_, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.write('{"slow":');
  });
  await withServer(upstream, async (upstreamBaseUrl) => {
    const proxy = createProxyServer({ mode: "forward", internalToken: "fixture-token", upstreamBaseUrl, upstreamTimeoutMs: 30 });
    await withServer(proxy, async (baseUrl) => {
      const res = await fetch(`${baseUrl}${routePath("promotion.reward.prepare")}`, {
        method: "POST",
        headers: { authorization: "Bearer fixture-token", "content-type": "application/json" },
        body: JSON.stringify({ promotionCode: "fixture-promotion", tossUserKey: "fixture-user" }),
      });
      expect(res.status).toBe(504);
      expect(await res.json()).toEqual(row.response);
    });
  });
});

async function withServer(server, fn) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    return await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}
