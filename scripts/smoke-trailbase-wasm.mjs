#!/usr/bin/env bun
// Disposable Docker network/depot only. This never touches consumer deployments.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  copyFile,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createSseParser } from "../packages/trailbase-client/src/index.ts";

const image =
  process.env.TRAILBASE_SMOKE_IMAGE || "trailbase/trailbase:0.33.14";
const root = path.resolve(import.meta.dirname, "..");
const scratch = await mkdtemp(path.join(tmpdir(), "trailbase-kit-smoke-"));
const suffix = randomUUID().slice(0, 8);
const network = `kit-smoke-${suffix}`;
const server = `${network}-server`;
const proxy = `${network}-proxy`;
const proxyImage = `toss-mtls-client-proxy:kit-smoke-${suffix}`;
const createdContainers = [];
let networkCreated = false;
const run = (command, args) =>
  execFileSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 16 * 1024 * 1024,
  }).trim();
const docker = (...args) => run("docker", args);
const checks = [];
try {
  console.log(`Building smoke component for ${image}`);
  run("cargo", [
    "build",
    "-p",
    "trailbase-guest-common",
    "--example",
    "compat_smoke",
    "--features",
    "compat-smoke",
    "--target",
    "wasm32-wasip2",
    "--release",
  ]);
  run("cargo", ["build", "-p", "trailbase-toss-identity", "--example", "keyring_smoke",
    "--features", "compat-smoke", "--target", "wasm32-wasip2", "--release"]);
  docker(
    "build",
    "-f",
    "services/toss-mtls-client-proxy/Dockerfile",
    "-t",
    proxyImage,
    ".",
  );
  await mkdir(path.join(scratch, "wasm"), { recursive: true });
  await mkdir(path.join(scratch, "migrations/main"), { recursive: true });
  await copyFile(
    path.join(root, "target/wasm32-wasip2/release/examples/compat_smoke.wasm"),
    path.join(scratch, "wasm/compat_smoke.wasm"),
  );
  await copyFile(path.join(root, "target/wasm32-wasip2/release/examples/keyring_smoke.wasm"),
    path.join(scratch, "wasm/keyring_smoke.wasm"));
  const templates = [
    "app_reward_attempts.sql",
    "toss_identities.sql",
    "message_templates.sql",
    "notification_template_agreements.sql",
    "message_outbox.core.sql",
    "message_outbox_attempts.sql",
    "promotion_campaigns.sql",
    "promotion_reward_ledger.sql",
    "iap_orders.sql",
    "iap_subscriptions.sql",
    "anonymous_identities.sql",
    "message_outbox_recipients.migration.sql",
    "promotion_reward_recipients.sql",
  ];
  const sql = (
    await Promise.all(
      templates.map((file) =>
        readFile(path.join(root, "templates/trailbase/sql", file), "utf8"),
      ),
    )
  ).join("\n");
  await writeFile(
    path.join(scratch, "migrations/main/U1750000000__kit.sql"),
    `${sql}\nCREATE TABLE smoke_items (id INTEGER PRIMARY KEY, owner BLOB NOT NULL REFERENCES _user(id), value TEXT NOT NULL) STRICT;\nCREATE TABLE smoke_reseal_cursor (id INTEGER PRIMARY KEY,cursor TEXT,complete INTEGER NOT NULL) STRICT;\n`,
  );
  await writeFile(
    path.join(scratch, "config.textproto"),
    `server: { application_name: "Kit smoke" site_url: "http://localhost:4000" }
record_apis: [{
    name: "smoke_items"
    table_name: "smoke_items"
    acl_authenticated: [READ]
    enable_subscriptions: true
    read_access_rule: "_ROW_.owner = _USER_.id"
  }]\n`,
  );
  docker("network", "create", network);
  networkCreated = true;
  docker(
    "run",
    "-d",
    "--name",
    proxy,
    "--network",
    network,
    "--network-alias",
    "kit-proxy",
    "-e",
    "MTLS_PROXY_MODE=stub",
    "-e",
    "MTLS_PROXY_TOKEN=dev-token",
    proxyImage,
  );
  createdContainers.push(proxy);
  docker(
    "run",
    "-d",
    "--name",
    server,
    "--user",
    `${process.getuid()}:${process.getgid()}`,
    "-e",
    "XDG_CACHE_HOME=/app/traildepot/.cache",
    "--network",
    network,
    "-p",
    "127.0.0.1::4000",
    "-v",
    `${scratch}:/app/traildepot`,
    image,
    "/app/trail",
    "--data-dir",
    "/app/traildepot",
    "run",
    "--address",
    "0.0.0.0:4000",
    "--runtime-threads",
    "2",
    "--demo",
  );
  createdContainers.push(server);
  const port = docker("port", server, "4000/tcp").split(":").at(-1);
  const base = `http://127.0.0.1:${port}`;
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(`${base}/kit-smoke/ready`, {
        signal: AbortSignal.timeout(1000),
      });
      if (response.ok) break;
    } catch {}
    if (docker("inspect", "--format", "{{.State.Running}}", server) !== "true")
      throw new Error("Smoke server exited before readiness");
    if (attempt >= 120)
      throw new Error("Smoke WASM component did not become ready");
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  checks.push("component startup and legacy --data-dir alias");
  const request = async (url, { tokens, method = "GET", body } = {}) => {
    const response = await fetch(`${base}${url}`, {
      method,
      signal: AbortSignal.timeout(15000),
      headers: {
        ...(body ? { "content-type": "application/json" } : {}),
        ...(tokens
          ? {
              authorization: `Bearer ${tokens.auth_token}`,
              "CSRF-Token": tokens.csrf_token,
            }
          : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const value = await response.json();
    assert.ok(
      response.ok,
      `${url} returned ${response.status}: ${JSON.stringify(value).replace(/eyJ[\w.-]+/g, "[token]")}`,
    );
    return value;
  };
  const alpha = await request("/kit-smoke/bootstrap?seed=alpha", {
    method: "POST",
  });
  const again = await request("/kit-smoke/bootstrap?seed=alpha", {
    method: "POST",
  });
  const beta = await request("/kit-smoke/bootstrap?seed=beta", {
    method: "POST",
  });
  const alphaUser = await request("/kit-smoke/private", { tokens: alpha });
  assert.deepEqual(
    await request("/kit-smoke/private", { tokens: again }),
    alphaUser,
  );
  assert.notDeepEqual(
    await request("/kit-smoke/private", { tokens: beta }),
    alphaUser,
  );
  assert.ok(alpha.auth_token && alpha.refresh_token && alpha.csrf_token);
  checks.push(
    "verified anonymous stub bootstrap, official login, repeat principal, authenticated WASM",
  );
  assert.equal((await fetch(`${base}/kit-smoke/private`)).status, 401);
  const denied = await fetch(`${base}/api/records/v1/smoke_items`);
  assert.ok([401, 403].includes(denied.status));
  const noCsrf = await fetch(`${base}/kit-smoke/write`, {
    method: "POST",
    headers: { authorization: `Bearer ${alpha.auth_token}` },
  });
  assert.equal(noCsrf.status, 403);
  assert.equal(
    (await request("/kit-smoke/toss-login", { method: "POST" })).ok,
    true,
  );
  checks.push(
    "unauthenticated and CSRF denial; Toss login SANDBOX through explicit proxy stub",
  );
  const sseAbort = new AbortController();
  const timeout = setTimeout(() => sseAbort.abort(), 20000);
  const stream = await fetch(`${base}/api/records/v1/smoke_items/subscribe/*`, {
    headers: { authorization: `Bearer ${alpha.auth_token}` },
    signal: sseAbort.signal,
  });
  assert.equal(stream.status, 200);
  const reader = stream.body.getReader();
  const events = [];
  const parser = createSseParser((event) => {
    if (event.data.trim()) events.push(JSON.parse(event.data));
  });
  const decoder = new TextDecoder();
  const nextEvent = async () => {
    while (!events.length) {
      const { value, done } = await reader.read();
      assert.equal(done, false);
      parser.push(decoder.decode(value, { stream: true }));
    }
    return events.shift();
  };
  try {
    await request("/kit-smoke/write?op=insert", {
      method: "POST",
      tokens: alpha,
    });
    assert.equal((await nextEvent()).Insert.value, "initial");
    assert.equal(
      (await request("/api/records/v1/smoke_items", { tokens: alpha })).records
        .length,
      1,
    );
    assert.equal(
      (await request("/api/records/v1/smoke_items", { tokens: beta })).records
        .length,
      0,
    );
    const forbiddenWrite = await fetch(`${base}/api/records/v1/smoke_items`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${alpha.auth_token}`,
        "CSRF-Token": alpha.csrf_token,
        "content-type": "application/json",
      },
      body: JSON.stringify({ id: 2, owner: alphaUser.userId, value: "denied" }),
    });
    assert.equal(forbiddenWrite.status, 403);
    await request("/kit-smoke/write?op=update", {
      method: "POST",
      tokens: alpha,
    });
    assert.equal((await nextEvent()).Update.value, "updated");
    await request("/kit-smoke/write?op=delete", {
      method: "POST",
      tokens: alpha,
    });
    assert.ok((await nextEvent()).Delete);
  } finally {
    clearTimeout(timeout);
    await reader.cancel().catch(() => {});
    sseAbort.abort();
  }
  checks.push(
    "Record API ownership/read-only ACL and SSE insert/update/delete",
  );
  assert.deepEqual(await request("/kit-smoke/rewards", { tokens: alpha, method: "POST" }), {
    schemaOk: true, replaySame: true, scopeDenied: true, granted: true,
  });
  checks.push("app reward tables/index coexistence, server issuance, once-only grant and scoped replay");
  assert.deepEqual(await request("/kit-smoke/keyring", { tokens: alpha, method: "POST" }), {
    legacyReadable: true, oldV2Readable: true, rewritten: 2, replayNoop: true,
    hmacUnchanged: true, timestampUnchanged: true, currentReadable: true,
    cursorCommitted: true, tombstonePreserved: true,
  });
  checks.push("real WASI nonce generation, v1/v2 reads, transactional reseal/cursor, replay and tombstone preservation");
  const refreshed = await request("/api/auth/v1/refresh", {
    method: "POST",
    body: { refresh_token: alpha.refresh_token },
  });
  assert.ok(refreshed.auth_token);
  checks.push(
    "official token refresh and combined functional-ledger migrations",
  );
  const serverImageId = docker("image", "inspect", image, "--format", "{{.Id}}");
  const proxyImageId = docker("image", "inspect", proxyImage, "--format", "{{.Id}}");
  console.log(JSON.stringify({ ok: true, image, serverImageId, proxyImageId,
    proxyMode: "source-built-stub", checks }, null, 2));
} catch (error) {
  if (createdContainers.includes(server)) {
    const logResult = spawnSync("docker", ["logs", server], {
      encoding: "utf8",
    });
    const logs = `${logResult.stdout || ""}\n${logResult.stderr || ""}`
      .split("\n")
      .filter((line) => !/password|token|secret/i.test(line))
      .slice(-20)
      .join("\n");
    console.error(logs);
  }
  throw error;
} finally {
  for (const name of createdContainers.reverse()) {
    try {
      docker("rm", "-f", name);
    } catch {}
  }
  if (networkCreated) {
    try {
      docker("network", "rm", network);
    } catch {}
  }
  try {
    docker("image", "rm", proxyImage);
  } catch {}
  await rm(scratch, { recursive: true, force: true });
}
