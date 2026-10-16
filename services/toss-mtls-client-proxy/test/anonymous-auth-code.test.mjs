import { expect, test } from "bun:test";
import http from "node:http";
import { Readable } from "node:stream";
import { ANONYMOUS_AUTH_CODE_EXCHANGE_PATH, handleRequest } from "../src/core.mjs";

function request(body, authorized = true) {
  return Object.assign(Readable.from([Buffer.from(JSON.stringify(body))]), {
    method: "POST", url: ANONYMOUS_AUTH_CODE_EXCHANGE_PATH,
    headers: authorized ? { authorization: "Bearer fixture-token" } : {},
  });
}

test("code exchange is private, forward-only, validated, and never fabricates a stub identity", async () => {
  let calls = 0;
  const core = { exchangeAnonAuthCode: async () => { calls++; throw new Error("must not dispatch"); } };
  const config = { mode: "forward", internalToken: "fixture-token" };
  expect((await handleRequest(request({ code: "single-use" }, false), config, core)).status).toBe(401);
  expect((await handleRequest(request({ code: "single-use" }), { ...config, mode: "stub" }, core)).body.error).toBe("FORWARD_MODE_REQUIRED");
  for (const code of [null, "", " ", "bad\ncode", "x".repeat(4097)]) {
    expect((await handleRequest(request({ code }), config, core)).body.error).toBe("INVALID_AUTH_CODE");
  }
  expect(calls).toBe(0);
});

test("published api-core exchanges once through the proxy transport and requires authoritative success", async () => {
  let calls = 0;
  let body = { resultType: "SUCCESS", success: { anonKey: "server-key" } };
  let status = 200;
  const upstream = http.createServer(async (req, res) => {
    calls++;
    expect(req.url).toBe("/api-partner/v1/apps-in-toss/users/anon-key/exchange");
    expect(req.method).toBe("POST");
    expect(req.headers["x-anon-key"]).toBeUndefined();
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    expect(JSON.parse(Buffer.concat(chunks).toString())).toEqual({ code: "private-once" });
    res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body));
  });
  await new Promise(resolve => upstream.listen(0, "127.0.0.1", resolve));
  try {
    const config = { mode: "forward", internalToken: "fixture-token", upstreamBaseUrl: `http://127.0.0.1:${upstream.address().port}` };
    const exchange = () => handleRequest(request({ code: "private-once" }), config);
    expect((await exchange()).body).toEqual({ ok: true, anonKey: "server-key", mode: "forward" });
    expect(calls).toBe(1);
    for (const payload of [
      { resultType: "FAIL", success: { anonKey: "server-key" }, error: { reason: "private-once" } },
      { resultType: "HTTP_TIMEOUT", success: { anonKey: "server-key" } },
      { success: { anonKey: "server-key" } },
      { resultType: "SUCCESS", success: { anonKey: " bad-key " } },
    ]) {
      body = payload;
      const before = calls;
      const result = (await exchange()).body;
      expect(result.ok).toBe(false);
      expect(calls).toBe(before + 1);
      expect(JSON.stringify(result)).not.toContain("private-once");
      expect(JSON.stringify(result)).not.toContain("server-key");
    }
    body = { resultType: "SUCCESS", success: { anonKey: "server-key" } }; status = 503;
    const before = calls;
    expect((await exchange()).body.error).toBe("UPSTREAM_UNAVAILABLE");
    expect(calls).toBe(before + 1);
  } finally { await new Promise(resolve => upstream.close(resolve)); }
});
