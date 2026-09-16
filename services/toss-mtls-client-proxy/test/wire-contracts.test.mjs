import { expect, test } from "bun:test";
import { Readable } from "node:stream";
import fixtures from "../../../fixtures/contracts/apps-in-toss.v1.json" with { type: "json" };
import { handleRequest } from "../src/http-server.mjs";

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
    const response = await handleRequest(request("/internal/apps-in-toss/iap/order/status", { orderId: "fixture-order", sku: "requested-sku" }),
      { mode: "forward", internalToken: "fixture-token" }, core);
    expect(response.status).toBe(200);
    expect(response.body).toEqual(row.proxyResponse);
  }
});

test("shared message wire fixtures retain partial delivery and both failure field spellings", async () => {
  for (const row of fixtures.message) {
    const core = { smartMessageSend: async () => structuredClone(row.coreResponse) };
    const response = await handleRequest(request("/internal/apps-in-toss/smart-message/send", {}),
      { mode: "forward", internalToken: "fixture-token" }, core);
    expect(response.status).toBe(200);
    expect(response.body).toEqual(row.proxyResponse);
  }
});
