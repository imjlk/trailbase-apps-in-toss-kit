import { expect, test } from "bun:test";
import { evaluateProxyCapabilities } from "@trailbase-apps-in-toss-kit/trailbase-runtime/proxy-capabilities";
import { handleRequest } from "../src/http-server.mjs";
const secret = "PRIVATE-CANARY";

test("doctor accepts the actual proxy metadata while health stays local", async () => {
  let healthCalls = 0;
  const req = { method: "GET", url: "/internal/apps-in-toss/health", headers: { authorization: `Bearer ${secret}` } };
  const response = await handleRequest(req, { mode: "forward", internalToken: secret }, { health: async () => {
    healthCalls++; return { ok: true, mode: "forward", token: secret };
  } });
  expect(healthCalls).toBe(1);
  expect(evaluateProxyCapabilities(response.body, { requiredCapabilities: ["promotion.prepare.v2", "promotion.execute.v2", "promotion.status.v2", "iap.provider-sku-required"] }).ok).toBe(true);
  // The removed batch-grant contract is no longer advertised; requiring it
  // fails the preflight so stale consumers cannot deploy against it.
  expect(evaluateProxyCapabilities(response.body, { requiredCapabilities: ["promotion.grant"] }).ok).toBe(false);
  expect(JSON.stringify(response.body)).not.toContain(secret);
  const denied = await handleRequest({ ...req, headers: {} }, { mode: "forward", internalToken: secret }, {});
  expect(denied.status).toBe(401);
  expect(denied.body.kit).toBeUndefined();
});

