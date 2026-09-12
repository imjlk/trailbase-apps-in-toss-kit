import { expect, test } from "bun:test";
import { createProxyCapabilitiesCheck, evaluateProxyCapabilities } from "../src/proxy-capabilities.mjs";
import { createReleaseDoctorChecksFromConfig, runReleaseDoctor } from "../src/release-doctor.mjs";

const metadata = { contractVersion: 1, proxyVersion: "0.3.0", capabilities: ["promotion.status", "anonymous-key.verify"] };
const health = { ok: true, mode: "forward", kit: metadata };
const secret = "PRIVATE-CANARY";
const options = { url: "http://proxy.internal", token: secret };
const check = (body, extra = {}) => createProxyCapabilitiesCheck({ ...options, fetchImpl: async () => Response.json(body), ...extra }).run();

test("legacy, unhealthy, wrong-mode and future contracts never pass silently", async () => {
  for (const body of [null, {}, { ok: true, mode: "forward" }, { ...health, ok: false },
    { ...health, mode: "stub" }, { ...health, kit: { ...metadata, contractVersion: 2 } }]) {
    expect((await check(body)).ok).toBe(false);
  }
  expect((await check({ ...health, mode: "stub" }, { expectedMode: "stub" })).ok).toBe(true);
});

test("minimum version comparison respects major, minor and patch ordering", () => {
  for (const version of ["0.2.99", "0.3.0", "0.3.1", "1.0.0", "0.10.0"]) {
    const result = evaluateProxyCapabilities({ ...health, kit: { ...metadata, proxyVersion: version } }, { minimumVersion: "0.3.1" });
    expect(result.ok).toBe(!["0.2.99", "0.3.0"].includes(version));
  }
  for (const version of ["01.3.0", "0.3.0-beta.01", "99999999999999999.0.0", null, 3]) {
    expect(evaluateProxyCapabilities({ ...health, kit: { ...metadata, proxyVersion: version } }).ok).toBe(false);
  }
});

test("missing and malformed capability requirements are rejected", () => {
  expect(evaluateProxyCapabilities(health, { requiredCapabilities: ["smart-message.send"] }).ok).toBe(false);
  for (const value of [null, "promotion.status", [secret], Array(101).fill("promotion.status")]) {
    expect(evaluateProxyCapabilities(health, { requiredCapabilities: value }).ok).toBe(false);
  }
  expect(evaluateProxyCapabilities(health, { minimumVersion: { toString: () => "0.3.0" } }).ok).toBe(false);
  expect(evaluateProxyCapabilities({ ...health, kit: { ...metadata, capabilities: [secret] } }).ok).toBe(false);
});

test("uses only the private health GET, never follows redirects, and reads secrets from env", async () => {
  let calls = 0;
  const result = await createProxyCapabilitiesCheck({ env: { MTLS_PROXY_URL: options.url, MTLS_PROXY_TOKEN: secret }, fetchImpl: async (url, init) => {
    calls++;
    expect(String(url)).toBe("http://proxy.internal/internal/apps-in-toss/health");
    expect(init.method).toBe("GET"); expect(init.redirect).toBe("error");
    expect(init.credentials).toBe("omit"); expect(init.headers.authorization).toBe(`Bearer ${secret}`);
    return Response.json(health);
  } }).run();
  expect(calls).toBe(1); expect(result.ok).toBe(true);
  expect(JSON.stringify(result)).not.toContain(secret);
});

test("invalid URLs and absent credentials do not make network calls", async () => {
  let calls = 0; const fetchImpl = async () => { calls++; return Response.json(health); };
  for (const url of ["http://user:pass@proxy.internal", "http://proxy.internal/path", "http://proxy.internal?token=PRIVATE-CANARY", "file:///etc/passwd", "bad-url"]) {
    expect((await createProxyCapabilitiesCheck({ ...options, url, fetchImpl }).run()).ok).toBe(false);
  }
  expect((await createProxyCapabilitiesCheck({ url: options.url, token: "", fetchImpl }).run()).ok).toBe(false);
  expect(calls).toBe(0);
});

test("transport errors, response text and malformed JSON cannot leak private context", async () => {
  for (const fetchImpl of [async () => { throw new Error(secret); }, async () => new Response(secret),
    async () => new Response(secret, { status: 500 }), async () => new Response(secret, { status: 302, headers: { location: `https://example.test/${secret}` } })]) {
    const result = await createProxyCapabilitiesCheck({ ...options, fetchImpl }).run();
    expect(result.ok).toBe(false); expect(JSON.stringify(result)).not.toContain(secret);
  }
});

test("body size is bounded with and without a content-length header", async () => {
  for (const headers of [{}, { "content-length": "20000" }]) {
    const result = await createProxyCapabilitiesCheck({ ...options, fetchImpl: async () => new Response(" ".repeat(20000), { headers }) }).run();
    expect(result.ok).toBe(false);
  }
});

test("deadline covers a stalled fetch and stalled response body", async () => {
  for (const fetchImpl of [() => new Promise(() => {}), async () => new Response(new ReadableStream({ start() {} }))]) {
    const result = await createProxyCapabilitiesCheck({ ...options, timeout: 10, fetchImpl }).run();
    expect(result.ok).toBe(false);
    expect(result.failures[0]).toContain("timed out");
  }
});

test("optional checks warn and JSON config cannot inject credentials or fetch code", async () => {
  const summary = await runReleaseDoctor({ checks: [createProxyCapabilitiesCheck({ ...options, required: false, fetchImpl: async () => Response.json({ ok: true, mode: "forward" }) })] });
  expect(summary.ok).toBe(true); expect(summary.warnings).toBe(1);
  const [configured] = createReleaseDoctorChecksFromConfig({ checks: [{ type: "proxy-capabilities", url: options.url,
    tokenEnv: "KIT_TEST_NONEXISTENT_TOKEN", token: secret, env: { KIT_TEST_NONEXISTENT_TOKEN: secret }, fetchImpl: () => { throw new Error("injected"); } }] });
  expect((await configured.run()).failures).toEqual(["Proxy token is required"]);
});

test("prerelease precedence and build metadata follow SemVer", () => {
  for (const [version, minimumVersion, expected] of [
    ["0.3.0-rc.1", "0.3.0", false], ["0.3.0", "0.3.0-rc.1", true],
    ["0.3.0-rc.10", "0.3.0-rc.2", true], ["0.3.0-rc.2", "0.3.0-rc.10", false],
    ["0.3.0+build.1", "0.3.0+build.999", true], ["0.4.0-alpha", "0.3.0", true],
  ]) {
    expect(evaluateProxyCapabilities({ ...health, kit: { ...metadata, proxyVersion: version } }, { minimumVersion }).ok).toBe(expected);
  }
  expect(evaluateProxyCapabilities({ ...health, kit: { ...metadata, proxyVersion: "0.3.0-rc.1" } }).ok).toBe(true);
});
