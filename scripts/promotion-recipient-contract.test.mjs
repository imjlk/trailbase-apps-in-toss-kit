import { expect, test } from "bun:test";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { createProxyServer, PROXY_ENDPOINTS, TOSS_ENDPOINTS } from "../services/toss-mtls-client-proxy/src/core.mjs";
import { createProxyCapabilitiesCheck } from "../packages/trailbase-runtime/src/proxy-capabilities.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const recipe = JSON.parse(readFileSync(new URL("../templates/trailbase/release/promotion-release-doctor.config.example.json", import.meta.url), "utf8"));
async function serve(server, task) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try { return await task(`http://127.0.0.1:${server.address().port}`); }
  finally { server.closeAllConnections(); await new Promise((resolve, reject) => server.close(error => error && error.code !== "ERR_SERVER_NOT_RUNNING" ? reject(error) : resolve())); }
}
async function body(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString() || "{}");
}

test("Rust promotion payloads preserve recipient identity through the real proxy and upstream headers", async () => {
  const child = Bun.spawn(["cargo", "run", "--locked", "--quiet", "-p", "trailbase-guest-common", "--example", "promotion_payloads"], {cwd: root, stdout: "pipe", stderr: "pipe"});
  const [exitCode, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  if (exitCode !== 0) throw new Error(`Rust fixture failed: ${stderr}`);
  const cases = JSON.parse(stdout);
  expect(cases.map(value => value.kind)).toEqual(["anonymous", "login"]);
  const seen = [];
  const bindings = new Map();
  const grants = new Map();
  const upstream = http.createServer(async (req, res) => {
    const payload = await body(req);
    const recipient = req.headers["x-anon-key"] ?? req.headers["x-toss-user-key"];
    seen.push({path: req.url, payload, anonymous: req.headers["x-anon-key"], login: req.headers["x-toss-user-key"]});
    const identity = `${req.headers["x-anon-key"] ? "anonymous" : "login"}:${recipient}`;
    let response;
    if (!recipient || (req.headers["x-anon-key"] && req.headers["x-toss-user-key"])) {
      response = {resultType: "FAIL", error: {errorCode: "4010", reason: "invalid recipient"}};
    } else if (req.url === TOSS_ENDPOINTS.promotionGetKey) {
      const key = recipient === "fixture-anonymous" ? "fixture-key-anonymous" : "fixture-key-login";
      bindings.set(key, identity);
      response = {resultType: "SUCCESS", success: {key}};
    } else if (bindings.get(payload.key) !== identity) {
      response = {resultType: "FAIL", error: {errorCode: "4010", reason: "recipient mismatch"}};
    } else if (req.url === TOSS_ENDPOINTS.promotionExecute) {
      grants.set(payload.key, (grants.get(payload.key) ?? 0) + 1);
      response = {resultType: "SUCCESS", success: "SUCCESS"};
    } else if (req.url === TOSS_ENDPOINTS.promotionResult && grants.has(payload.key)) {
      response = {resultType: "SUCCESS", success: "SUCCESS"};
    } else {
      res.writeHead(404); res.end(); return;
    }
    res.writeHead(200, {"content-type": "application/json"}); res.end(JSON.stringify(response));
  });
  await serve(upstream, async upstreamBaseUrl => {
    const proxy = createProxyServer({mode: "forward", internalToken: "fixture-token", upstreamBaseUrl});
    await serve(proxy, async baseUrl => {
      const check = await createProxyCapabilitiesCheck({...recipe.checks[0], url: baseUrl, token: "fixture-token"}).run();
      expect(check.ok).toBe(true);
      expect(seen).toHaveLength(0); // Readiness must not touch the upstream or grant points.
      const post = async (route, payload) => {
        const response = await fetch(`${baseUrl}${route}`, {method: "POST", headers: {authorization: "Bearer fixture-token", "content-type": "application/json"}, body: JSON.stringify(payload)});
        expect(response.status).toBe(200);
        return response.json();
      };
      for (const fixture of cases) {
        const start = seen.length;
        const prepared = await post(PROXY_ENDPOINTS.promotionPrepareReward, fixture.prepare);
        expect(prepared.providerTransactionKey).toBe(fixture.execute.providerTransactionKey);
        expect((await post(PROXY_ENDPOINTS.promotionExecuteReward, fixture.execute)).ok).toBe(true);
        expect((await post(PROXY_ENDPOINTS.promotionRewardStatus, fixture.status)).status).toBe("GRANTED");
        const calls = seen.slice(start);
        expect(calls.map(call => call.path)).toEqual([TOSS_ENDPOINTS.promotionGetKey, TOSS_ENDPOINTS.promotionExecute, TOSS_ENDPOINTS.promotionResult]);
        for (const call of calls) {
          expect(call.anonymous).toBe(fixture.kind === "anonymous" ? "fixture-anonymous" : undefined);
          expect(call.login).toBe(fixture.kind === "login" ? "fixture-login" : undefined);
        }
        expect(calls[1].payload).toEqual({key: fixture.execute.providerTransactionKey, promotionCode: "fixture-promotion", amount: 5});
        expect(grants.get(fixture.execute.providerTransactionKey)).toBe(1);
      }
      // Reproduce the historical wrong-field mistake: the provider rejects a
      // login header carrying an anonymous key even though the string is valid.
      const invalid = {...cases[0].execute, tossUserKey: cases[0].execute.anonKey};
      delete invalid.anonKey;
      const before = grants.get(invalid.providerTransactionKey);
      const rejected = await post(PROXY_ENDPOINTS.promotionExecuteReward, invalid);
      expect(rejected.ok).toBe(false);
      expect(rejected.providerErrorCode).toBe("4010");
      expect(grants.get(invalid.providerTransactionKey)).toBe(before);
      const callsBeforeMixed = seen.length;
      const mixed = {...cases[0].execute, tossUserKey: "fixture-login"};
      const denied = await fetch(`${baseUrl}${PROXY_ENDPOINTS.promotionExecuteReward}`, {method: "POST", headers: {authorization: "Bearer fixture-token", "content-type": "application/json"}, body: JSON.stringify(mixed)});
      expect(denied.status).toBe(400);
      expect(seen).toHaveLength(callsBeforeMixed);
      expect(grants.get(invalid.providerTransactionKey)).toBe(before);
    });
  });
}, 120000);
