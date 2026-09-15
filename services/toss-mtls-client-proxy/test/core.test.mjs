import { describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import http from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import {
  PROXY_ENDPOINTS,
  ANONYMOUS_KEY_VERIFY_PATH,
  TOSS_ANONYMOUS_KEY_VERIFY_PATH,
  PROMOTION_REWARD_STATUS_PATH,
  DEFAULT_PORT,
  SMART_MESSAGE_BULK_MAX_CONTEXTS,
  TOSS_ENDPOINTS,
  createConfig,
  createNodeMtlsClient,
  createProxyServer,
  handleRequest,
} from "../src/core.mjs";

const serviceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("toss-mtls-client-proxy", () => {
  test("server process exits cleanly on SIGTERM", async () => {
    const child = spawn(process.execPath, ["src/server.mjs"], {
      cwd: serviceRoot,
      env: {
        ...process.env,
        PORT: "0",
        MTLS_PROXY_MODE: "stub",
        MTLS_PROXY_TOKEN: "",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    try {
      await waitFor(() => stdout.includes("\"event\":\"toss-mtls-client-proxy.ready\"") || child.exitCode !== null);
      expect(child.exitCode).toBe(null);

      const exit = once(child, "exit");
      child.kill("SIGTERM");
      const [code, signal] = await exit;

      expect(code).toBe(0);
      expect(signal).toBe(null);
      expect(stdout).toContain("\"event\":\"toss-mtls-client-proxy.shutdown\"");
      expect(stderr).not.toContain("toss-mtls-client-proxy.shutdown.timeout");
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
      }
    }
  });

  test("rejects unauthorized requests when token is configured", async () => {
    const req = request("GET", PROXY_ENDPOINTS.health);
    const res = await handleRequest(req, { mode: "stub", internalToken: "secret" });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("UNAUTHORIZED");
  });

  test("health response preserves the proxy public shape", async () => {
    const req = request("GET", PROXY_ENDPOINTS.health);
    const res = await handleRequest(req, { mode: "stub", internalToken: "" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, mode: "stub", kit: { contractVersion: 1 } });
    expect(res.body.kit.proxyVersion).toBe((await import("../package.json")).default.version);
    expect(res.body.kit.capabilities).toContain("promotion.status");
  });

  test("requires an internal token in forward mode", () => {
    expect(() =>
      createProxyServer({
        mode: "forward",
        internalToken: "",
        upstreamBaseUrl: "https://apps-in-toss-api.toss.im",
      }),
    ).toThrow("MTLS_PROXY_TOKEN is required in forward mode");
  });

  test("parses bounded runtime settings from environment", () => {
    const config = createConfig({
      MTLS_PROXY_MODE: "FORWARD",
      MTLS_PROXY_TOKEN: "token",
      MTLS_UPSTREAM_BASE_URL: "https://apps-in-toss-api.toss.im",
      MTLS_PROXY_REQUEST_BODY_LIMIT_BYTES: "123",
      MTLS_PROXY_UPSTREAM_BODY_LIMIT_BYTES: "456",
      MTLS_PROXY_UPSTREAM_TIMEOUT_MS: "789",
      MTLS_PROXY_IAP_ORDER_STATUS_MAX_ATTEMPTS: "2",
      MTLS_PROXY_IAP_ORDER_STATUS_RETRY_DELAY_MS: "0",
      MTLS_PROXY_DEBUG: "true",
      PORT: "0",
    });
    expect(config.mode).toBe("forward");
    expect(config.port).toBe(0);
    expect(config.requestBodyLimitBytes).toBe(123);
    expect(config.upstreamBodyLimitBytes).toBe(456);
    expect(config.upstreamTimeoutMs).toBe(789);
    expect(config.iapOrderStatusMaxAttempts).toBe(2);
    expect(config.iapOrderStatusRetryDelayMs).toBe(0);
    expect(config.debug).toBe(true);
    expect(createConfig({ PORT: "" }).port).toBe(DEFAULT_PORT);
  });

  test("detects Toss console certificate filenames from the mounted cert directory", () => {
    const certDir = mkdtempSync(path.join(tmpdir(), "toss-mtls-"));
    try {
      writeFileSync(path.join(certDir, "sample-service_public.crt"), "cert");
      writeFileSync(path.join(certDir, "sample-service_private.key"), "key");

      const config = createConfig({
        MTLS_PROXY_MODE: "FORWARD",
        MTLS_PROXY_TOKEN: "token",
        MTLS_UPSTREAM_BASE_URL: "https://apps-in-toss-api.toss.im",
        MTLS_CERT_DIR: certDir,
      });

      expect(config.clientCertPath).toBe(path.join(certDir, "sample-service_public.crt"));
      expect(config.clientKeyPath).toBe(path.join(certDir, "sample-service_private.key"));
    } finally {
      rmSync(certDir, { recursive: true, force: true });
    }
  });

  test("prefers a complete Toss certificate pair over explicit fallback paths", () => {
    const certDir = mkdtempSync(path.join(tmpdir(), "toss-mtls-"));
    try {
      writeFileSync(path.join(certDir, "sample-service_public.crt"), "cert");
      writeFileSync(path.join(certDir, "sample-service_private.key"), "key");

      const config = createConfig({
        MTLS_CERT_DIR: certDir,
        MTLS_CLIENT_CERT_PATH: "/custom/client.crt",
        MTLS_CLIENT_KEY_PATH: "/custom/client.key",
      });

      expect(config.clientCertPath).toBe(path.join(certDir, "sample-service_public.crt"));
      expect(config.clientKeyPath).toBe(path.join(certDir, "sample-service_private.key"));
    } finally {
      rmSync(certDir, { recursive: true, force: true });
    }
  });

  test("node mTLS client fails closed for unreadable configured CA files", async () => {
    const certDir = mkdtempSync(path.join(tmpdir(), "toss-mtls-"));
    try {
      const clientCertPath = path.join(certDir, "client.crt");
      const clientKeyPath = path.join(certDir, "client.key");
      writeFileSync(clientCertPath, "cert");
      writeFileSync(clientKeyPath, "key");

      const client = createNodeMtlsClient({
        clientCertPath,
        clientKeyPath,
        caCertPath: path.join(certDir, "missing-ca.pem"),
      });

      await expect(client.request("https://127.0.0.1/internal", { method: "GET" })).rejects.toThrow(
        "MTLS_CA_CERT_PATH is missing or unreadable",
      );
    } finally {
      rmSync(certDir, { recursive: true, force: true });
    }
  });

  test("node mTLS client rejects unsupported request body types", async () => {
    const client = createNodeMtlsClient({});
    await expect(client.request("http://127.0.0.1/internal", { method: "POST", body: { bad: true } })).rejects.toThrow(
      "Unsupported request body type",
    );
  });

  test("uses explicit certificate paths when no complete Toss pair is available", () => {
    const certDir = mkdtempSync(path.join(tmpdir(), "toss-mtls-"));
    try {
      writeFileSync(path.join(certDir, "sample-service_public.crt"), "cert");

      const config = createConfig({
        MTLS_CERT_DIR: certDir,
        MTLS_CLIENT_CERT_PATH: "/custom/client.crt",
        MTLS_CLIENT_KEY_PATH: "/custom/client.key",
      });

      expect(config.clientCertPath).toBe("/custom/client.crt");
      expect(config.clientKeyPath).toBe("/custom/client.key");
    } finally {
      rmSync(certDir, { recursive: true, force: true });
    }
  });

  test("returns deterministic stub login response", async () => {
    const req = request("POST", PROXY_ENDPOINTS.tossLoginComplete, {
      authorizationCode: "code",
      referrer: "sandbox",
    });
    const res = await handleRequest(req, { mode: "stub", internalToken: "" });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.userKey.startsWith("stub-login:")).toBe(true);
    expect(res.body.referrer).toBe("sandbox");
  });

  test("preserves SDK sandbox referrer casing", async () => {
    const req = request("POST", PROXY_ENDPOINTS.tossLoginComplete, {
      authorizationCode: "code",
      referrer: "SANDBOX",
    });
    const res = await handleRequest(req, { mode: "stub", internalToken: "" });
    expect(res.body.referrer).toBe("SANDBOX");
  });

  test("forward login complete returns backend-only token metadata for later unlink", async () => {
    const seen = [];
    const upstreamServer = http.createServer(async (req, res) => {
      seen.push({
        url: req.url,
        method: req.method,
        authorization: req.headers.authorization,
        body: req.method === "POST" ? await readRequestJson(req) : undefined,
      });
      res.writeHead(200, { "content-type": "application/json" });
      if (req.url === TOSS_ENDPOINTS.loginGenerateToken) {
        res.end(
          JSON.stringify({
            resultType: "SUCCESS",
            success: {
              accessToken: "toss-access-token",
              refreshToken: "toss-refresh-token",
              tokenType: "Bearer",
              expiresIn: 3599,
              scope: "user_key user_name",
            },
          }),
        );
        return;
      }
      res.end(
        JSON.stringify({
          resultType: "SUCCESS",
          success: {
            userKey: "sensitive-toss-user-key",
            scope: "user_key",
            agreedTerms: ["terms-1"],
          },
        }),
      );
    });
    await withServer(upstreamServer, async (upstreamBaseUrl) => {
      const req = request(
        "POST",
        PROXY_ENDPOINTS.tossLoginComplete,
        {
          authorizationCode: "code",
          referrer: "SANDBOX",
        },
        { authorization: "Bearer secret" },
      );
      const res = await handleRequest(req, {
        mode: "forward",
        internalToken: "secret",
        upstreamBaseUrl,
      });

      expect(seen).toEqual([
        {
          url: TOSS_ENDPOINTS.loginGenerateToken,
          method: "POST",
          authorization: undefined,
          body: { authorizationCode: "code", referrer: "SANDBOX" },
        },
        {
          url: TOSS_ENDPOINTS.loginMe,
          method: "GET",
          authorization: "Bearer toss-access-token",
          body: undefined,
        },
      ]);
      expect(res.body).toMatchObject({
        ok: true,
        userKey: "sensitive-toss-user-key",
        referrer: "SANDBOX",
        scopes: ["user_key"],
        agreedTerms: ["terms-1"],
        accessToken: "toss-access-token",
        refreshToken: "toss-refresh-token",
        tokenType: "Bearer",
        expiresIn: 3599,
      });
    });
  });

  test("stub login unlink response does not expose the Toss user key", async () => {
    const req = request("POST", PROXY_ENDPOINTS.tossLoginRemoveByUserKey, {
      userKey: "sensitive-toss-user-key",
    });
    const res = await handleRequest(req, { mode: "stub", internalToken: "" });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.providerStatus).toBe("REMOVED");
    expect(JSON.stringify(res.body)).not.toContain("sensitive-toss-user-key");
  });

  test("forward login unlink targets the Toss remove-by-user-key API", async () => {
    const seen = [];
    const upstreamServer = http.createServer(async (req, res) => {
      seen.push({
        url: req.url,
        authorization: req.headers.authorization,
        tossUserKeyHeader: req.headers["x-toss-user-key"],
        body: await readRequestJson(req),
      });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          resultType: "SUCCESS",
          success: {
            userKey: "sensitive-toss-user-key",
          },
        }),
      );
    });
    await withServer(upstreamServer, async (upstreamBaseUrl) => {
      const req = request(
        "POST",
        PROXY_ENDPOINTS.tossLoginRemoveByUserKey,
        {
          tossUserKey: "sensitive-toss-user-key",
          accessToken: "toss-access-token",
        },
        { authorization: "Bearer secret" },
      );
      const res = await handleRequest(req, {
        mode: "forward",
        internalToken: "secret",
        upstreamBaseUrl,
      });
      expect(seen).toEqual([
        {
          url: TOSS_ENDPOINTS.loginRemoveByUserKey,
          authorization: "Bearer toss-access-token",
          tossUserKeyHeader: "sensitive-toss-user-key",
          body: { userKey: "sensitive-toss-user-key" },
        },
      ]);
      expect(res.body.ok).toBe(true);
      expect(res.body.providerStatus).toBe("REMOVED");
      expect(JSON.stringify(res.body)).not.toContain("sensitive-toss-user-key");
      expect(JSON.stringify(res.body)).not.toContain("toss-access-token");
    });
  });

  test("forward login unlink requires a Toss access token in the request body", async () => {
    const req = request(
      "POST",
      PROXY_ENDPOINTS.tossLoginRemoveByUserKey,
      {
        tossUserKey: "sensitive-toss-user-key",
      },
      { authorization: "Bearer secret" },
    );
    const res = await handleRequest(req, {
      mode: "forward",
      internalToken: "secret",
      upstreamBaseUrl: "http://upstream.test",
    });
    expect(res.body).toEqual({
      ok: false,
      error: "MISSING_TOSS_ACCESS_TOKEN",
      providerStatus: "ERROR",
    });
  });

  test("forward login unlink redacts the Toss user key from failure reasons", async () => {
    const upstreamServer = http.createServer((req, res) => {
      req.resume();
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          resultType: "FAIL",
          error: {
            errorCode: "USER_KEY_NOT_FOUND",
            reason: "cannot unlink sensitive-toss-user-key using expired-access-token",
          },
        }),
      );
    });
    await withServer(upstreamServer, async (upstreamBaseUrl) => {
      const req = request(
        "POST",
        PROXY_ENDPOINTS.tossLoginRemoveByUserKey,
        {
          userKey: "sensitive-toss-user-key",
          accessToken: "Bearer expired-access-token",
        },
        { authorization: "Bearer secret" },
      );
      const res = await handleRequest(req, {
        mode: "forward",
        internalToken: "secret",
        upstreamBaseUrl,
      });
      expect(res.body.ok).toBe(false);
      expect(res.body.providerStatus).toBe("FAILED");
      expect(res.body.failureReason).toBe("cannot unlink [redacted] using [redacted]");
      expect(JSON.stringify(res.body)).not.toContain("sensitive-toss-user-key");
      expect(JSON.stringify(res.body)).not.toContain("expired-access-token");
    });
  });

  test("forward login unlink treats top-level Toss error codes as failures", async () => {
    const upstreamServer = http.createServer((req, res) => {
      req.resume();
      const payload = JSON.stringify({ errorCode: "USER_KEY_NOT_FOUND", message: "missing user key" });
      res.writeHead(200, {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(payload),
      });
      res.end(payload);
    });
    await withServer(upstreamServer, async (upstreamBaseUrl) => {
      const req = request(
        "POST",
        PROXY_ENDPOINTS.tossLoginRemoveByUserKey,
        {
          userKey: "sensitive-toss-user-key",
          accessToken: "expired-access-token",
        },
        { authorization: "Bearer secret" },
      );
      const res = await handleRequest(req, {
        mode: "forward",
        internalToken: "secret",
        upstreamBaseUrl,
      });
      expect(res.body.ok).toBe(false);
      expect(res.body.providerStatus).toBe("FAILED");
      expect(res.body.failureReason).toBe("missing user key");
      expect(res.body.providerErrorCode).toBe("USER_KEY_NOT_FOUND");
    });
  });

  test("forward login unlink treats top-level Toss errors as failures", async () => {
    const upstreamServer = http.createServer((req, res) => {
      req.resume();
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "invalid_grant" }));
    });
    await withServer(upstreamServer, async (upstreamBaseUrl) => {
      const req = request(
        "POST",
        PROXY_ENDPOINTS.tossLoginRemoveByUserKey,
        {
          userKey: "sensitive-toss-user-key",
          accessToken: "expired-access-token",
        },
        { authorization: "Bearer secret" },
      );
      const res = await handleRequest(req, {
        mode: "forward",
        internalToken: "secret",
        upstreamBaseUrl,
      });
      expect(res.body.ok).toBe(false);
      expect(res.body.providerStatus).toBe("FAILED");
      expect(res.body.failureReason).toBe("invalid_grant");
      expect(res.body.providerErrorCode).toBeUndefined();
      expect(JSON.stringify(res.body)).not.toContain("sensitive-toss-user-key");
      expect(JSON.stringify(res.body)).not.toContain("expired-access-token");
    });
  });

  test("forward login failure reads Toss error reason instead of object text", async () => {
    const upstreamServer = http.createServer((req, res) => {
      req.resume();
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          resultType: "FAIL",
          error: {
            errorCode: "OAUTH_ISSUE_TOKEN_ERROR",
            reason: "invalid_grant from Toss",
          },
        }),
      );
    });
    await withServer(upstreamServer, async (upstreamBaseUrl) => {
      const req = request(
        "POST",
        PROXY_ENDPOINTS.tossLoginComplete,
        {
          authorizationCode: "code",
          referrer: "sandbox",
        },
        { authorization: "Bearer secret" },
      );
      const res = await handleRequest(req, {
        mode: "forward",
        internalToken: "secret",
        upstreamBaseUrl,
      });
      expect(res.body.ok).toBe(false);
      expect(res.body.error).toBe("TOKEN_EXCHANGE_FAILED");
      expect(res.body.failureReason).toBe("invalid_grant from Toss");
    });
  });

  test("validates generic proxy path is relative", async () => {
    const req = request("POST", "/internal/mtls/request", {
      method: "POST",
      path: "https://example.com/anything",
      body: {},
    });
    await expect(
      handleRequest(req, {
        mode: "forward",
        internalToken: "",
        upstreamBaseUrl: "https://apps-in-toss-api.toss.im",
      }),
    ).rejects.toThrow("path must be a relative absolute path");
  });

  test("server returns sanitized 400 for invalid JSON", async () => {
    const server = createProxyServer({ mode: "stub", internalToken: "" });
    await withServer(server, async (baseUrl) => {
      const res = await fetch(`${baseUrl}${PROXY_ENDPOINTS.tossLoginComplete}`, {
        method: "POST",
        body: "{",
      });
      const body = await res.json();
      expect(res.status).toBe(400);
      expect(body.error).toBe("INVALID_JSON");
      expect(body.message).toBe("Invalid JSON");
    });
  });

  test("server rejects oversized request bodies", async () => {
    const server = createProxyServer({ mode: "stub", internalToken: "", requestBodyLimitBytes: 16 });
    await withServer(server, async (baseUrl) => {
      const res = await fetch(`${baseUrl}${PROXY_ENDPOINTS.tossLoginComplete}`, {
        method: "POST",
        body: JSON.stringify({ authorizationCode: "too-large" }),
      });
      const body = await res.json();
      expect(res.status).toBe(413);
      expect(body.error).toBe("REQUEST_BODY_TOO_LARGE");
    });
  });

  test("generic relay preserves top-level upstream error codes", async () => {
    const upstreamServer = http.createServer((req, res) => {
      req.resume();
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ errorCode: "UPSTREAM_CODE", message: "passthrough" }));
    });
    await withServer(upstreamServer, async (upstreamBaseUrl) => {
      const req = request(
        "POST",
        PROXY_ENDPOINTS.genericMtlRequest,
        {
          method: "POST",
          path: "/api-partner/v1/apps-in-toss/user/oauth2/access/remove-by-user-key",
          body: { userKey: "sensitive-toss-user-key" },
        },
        { authorization: "Bearer secret" },
      );
      const res = await handleRequest(req, {
        mode: "forward",
        internalToken: "secret",
        upstreamBaseUrl,
      });
      expect(res.body).toMatchObject({
        ok: true,
        status: 200,
        headers: { "content-type": "application/json" },
        body: { errorCode: "UPSTREAM_CODE", message: "passthrough" },
      });
    });
  });

  test("server returns 504 when upstream times out", async () => {
    const upstreamServer = http.createServer(() => {});
    await withServer(upstreamServer, async (upstreamBaseUrl) => {
      const server = createProxyServer({
        mode: "forward",
        internalToken: "secret",
        upstreamBaseUrl,
        upstreamTimeoutMs: 20,
      });
      await withServer(server, async (baseUrl) => {
        const res = await fetch(`${baseUrl}${PROXY_ENDPOINTS.genericMtlRequest}`, {
          method: "POST",
          headers: {
            authorization: "Bearer secret",
            "content-type": "application/json",
          },
          body: JSON.stringify({ method: "GET", path: "/slow" }),
        });
        const body = await res.json();
        expect(res.status).toBe(504);
        expect(body.error).toBe("UPSTREAM_TIMEOUT");
      });
    });
  });

  test("server rejects oversized upstream responses", async () => {
    const upstreamServer = http.createServer((_, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: "too-large" }));
    });
    await withServer(upstreamServer, async (upstreamBaseUrl) => {
      const server = createProxyServer({
        mode: "forward",
        internalToken: "secret",
        upstreamBaseUrl,
        upstreamBodyLimitBytes: 8,
      });
      await withServer(server, async (baseUrl) => {
        const res = await fetch(`${baseUrl}${PROXY_ENDPOINTS.genericMtlRequest}`, {
          method: "POST",
          headers: {
            authorization: "Bearer secret",
            "content-type": "application/json",
          },
          body: JSON.stringify({ method: "GET", path: "/large" }),
        });
        const body = await res.json();
        expect(res.status).toBe(502);
        expect(body.error).toBe("UPSTREAM_RESPONSE_TOO_LARGE");
      });
    });
  });

  test("stub promotion rewards do not require Toss upstream env", async () => {
    const req = request("POST", PROXY_ENDPOINTS.promotionRewardGrant, {
      providerRequestId: "smoke",
      requestedAt: 1,
    });
    const res = await handleRequest(req, { mode: "stub", internalToken: "" });
    expect(res.body.providerStatus).toBe("GRANTED");
    expect(res.body.providerRequestId).toBe("smoke");
  });

  test("forward promotion rewards can use request-level campaign values", async () => {
    const calls = [];
    const upstreamServer = http.createServer((req, res) => {
      readRequestJson(req).then((body) => {
        calls.push({
          body,
          path: req.url,
          tossUserKey: req.headers["x-toss-user-key"],
        });
        res.writeHead(200, { "content-type": "application/json" });
        if (req.url === TOSS_ENDPOINTS.promotionGetKey) {
          res.end(JSON.stringify({ resultType: "SUCCESS", success: { key: "promotion-key" } }));
          return;
        }
        if (req.url === TOSS_ENDPOINTS.promotionExecute) {
          res.end(JSON.stringify({ resultType: "SUCCESS", success: { key: "promotion-key" } }));
          return;
        }
        res.end(JSON.stringify({ resultType: "SUCCESS", success: "SUCCESS" }));
      });
    });
    await withServer(upstreamServer, async (upstreamBaseUrl) => {
      const req = request(
        "POST",
        PROXY_ENDPOINTS.promotionRewardGrant,
        {
          amount: 50,
          promotionCode: "campaign-from-db",
          providerRequestId: "attendance-1",
          tossUserKey: "toss-user-1",
        },
        { authorization: "Bearer secret" },
      );
      const res = await handleRequest(req, {
        mode: "forward",
        internalToken: "secret",
        upstreamBaseUrl,
      });
      expect(res.body.providerStatus).toBe("GRANTED");
      expect(calls.map((call) => call.path)).toEqual([
        TOSS_ENDPOINTS.promotionGetKey,
        TOSS_ENDPOINTS.promotionExecute,
        TOSS_ENDPOINTS.promotionResult,
      ]);
      expect(calls[1].body).toEqual({
        amount: 50,
        key: "promotion-key",
        promotionCode: "campaign-from-db",
      });
      expect(calls.every((call) => call.tossUserKey === "toss-user-1")).toBe(true);
    });
  });

  test("forward promotion execute failures include provider error codes", async () => {
    const upstreamServer = http.createServer((req, res) => {
      req.resume();
      res.writeHead(200, { "content-type": "application/json" });
      if (req.url === TOSS_ENDPOINTS.promotionGetKey) {
        res.end(JSON.stringify({ resultType: "SUCCESS", success: { key: "promotion-key" } }));
        return;
      }
      res.end(
        JSON.stringify({
          error: {
            errorCode: "4112",
            message: "프로모션 머니가 부족해요",
          },
          resultType: "FAIL",
        }),
      );
    });
    await withServer(upstreamServer, async (upstreamBaseUrl) => {
      const req = request(
        "POST",
        PROXY_ENDPOINTS.promotionRewardGrant,
        {
          amount: 50,
          promotionCode: "campaign-from-db",
          providerRequestId: "attendance-1",
          tossUserKey: "toss-user-1",
        },
        { authorization: "Bearer secret" },
      );
      const res = await handleRequest(req, {
        mode: "forward",
        internalToken: "secret",
        upstreamBaseUrl,
      });
      expect(res.body.providerStatus).toBe("PROMOTION_EXECUTE_FAILED");
      expect(res.body.providerErrorCode).toBe("4112");
      expect(res.body.failureReason).toBe("4112");
    });
  });

  test("promotion recovery only looks up the existing transaction key", async () => {
    const paths = [];
    const server = http.createServer(async (req, res) => {
      paths.push(req.url);
      expect(await readRequestJson(req)).toEqual({ promotionCode: "campaign", key: "existing-key" });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ resultType: "SUCCESS", success: { status: "SUCCESS" } }));
    });
    await withServer(server, async (upstreamBaseUrl) => {
      const response = await handleRequest(request("POST", PROMOTION_REWARD_STATUS_PATH, {
        promotionCode: "campaign", providerTransactionKey: "existing-key", tossUserKey: "test-user",
      }, { authorization: "Bearer secret" }), { mode: "forward", internalToken: "secret", upstreamBaseUrl });
      expect(paths).toEqual([TOSS_ENDPOINTS.promotionResult]);
      expect(response.body.providerTransactionKey).toBe("existing-key");
      expect(response.body.providerStatus).toBe("GRANTED");
    });
  });

  test("promotion result lookup rejects missing keys instead of creating a grant", async () => {
    await expect(handleRequest(request("POST", PROMOTION_REWARD_STATUS_PATH, {
      promotionCode: "campaign", tossUserKey: "test-user", amount: 10,
    }, { authorization: "Bearer secret" }), { mode: "forward", internalToken: "secret" }))
      .rejects.toThrow("providerTransactionKey is required");
  });

  test("anonymous verification requires both SUCCESS and a boolean result", async () => {
    let upstreamResponse = { resultType: "SUCCESS", success: true };
    let status = 200;
    const upstream = http.createServer(async (req, res) => {
      expect(req.url).toBe(TOSS_ANONYMOUS_KEY_VERIFY_PATH);
      expect(req.headers["x-anon-key"]).toBe("verification-key");
      expect(req.headers["x-toss-user-key"]).toBeUndefined();
      req.resume();
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(upstreamResponse));
    });
    await withServer(upstream, async (upstreamBaseUrl) => {
      const verify = () => handleRequest(request("POST", ANONYMOUS_KEY_VERIFY_PATH, { anonKey: "verification-key" },
        { authorization: "Bearer secret" }), { mode: "forward", internalToken: "secret", upstreamBaseUrl });
      expect((await verify()).body).toEqual({ ok: true, valid: true, resultType: "SUCCESS", mode: "forward" });
      upstreamResponse = { resultType: "SUCCESS", success: false };
      expect((await verify()).body.valid).toBe(false);
      for (const body of [
        { resultType: "SUCCESS", success: "true" },
        { resultType: "FAIL", success: true, error: { reason: "verification-key" } },
        { valid: true },
      ]) {
        upstreamResponse = body;
        const result = (await verify()).body;
        expect(result.ok).toBe(false);
        expect(result.valid).toBe(false);
        expect(JSON.stringify(result)).not.toContain("verification-key");
      }
      upstreamResponse = { resultType: "SUCCESS", success: true };
      status = 500;
      expect((await verify()).body.valid).toBe(false);
    });
  });

  test("anonymous verification uses explicit stub mode and internal authentication", async () => {
    const body = { anonKey: "development-key" };
    expect((await handleRequest(request("POST", ANONYMOUS_KEY_VERIFY_PATH, body), { mode: "stub", internalToken: "secret" })).status).toBe(401);
    const result = await handleRequest(request("POST", ANONYMOUS_KEY_VERIFY_PATH, body, { authorization: "Bearer secret" }), { mode: "stub", internalToken: "secret" });
    expect(result.body.mode).toBe("stub");
    expect(result.body.valid).toBe(true);
    await expect(handleRequest(request("POST", ANONYMOUS_KEY_VERIFY_PATH, { anonKey: "" }), { mode: "stub", internalToken: "" })).rejects.toThrow("non-empty");
  });

  test("anonymous promotion uses only x-anon-key for grant and existing-key recovery", async () => {
    const paths = [];
    const upstream = http.createServer(async (req, res) => {
      paths.push(req.url);
      // get-key takes no recipient header (official contract); execute and
      // result carry the anonymous recipient natively via api-core 0.3.
      if (req.url !== TOSS_ENDPOINTS.promotionGetKey) {
        expect(req.headers["x-anon-key"]).toBe("anonymous-recipient");
      } else {
        expect(req.headers["x-anon-key"]).toBeUndefined();
      }
      expect(req.headers["x-toss-user-key"]).toBeUndefined();
      expect(req.headers["x-user-key"]).toBeUndefined();
      await readRequestJson(req);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ resultType: "SUCCESS", success: req.url === TOSS_ENDPOINTS.promotionResult ? "SUCCESS" : { key: "transaction-key" } }));
    });
    await withServer(upstream, async (upstreamBaseUrl) => {
      const body = { anonKey: "anonymous-recipient", promotionCode: "campaign", amount: 10 };
      const config = { mode: "forward", internalToken: "secret", upstreamBaseUrl };
      const grant = await handleRequest(request("POST", PROXY_ENDPOINTS.promotionRewardGrant, body, { authorization: "Bearer secret" }), config);
      expect(grant.body.providerStatus).toBe("GRANTED");
      expect(paths).toEqual([TOSS_ENDPOINTS.promotionGetKey, TOSS_ENDPOINTS.promotionExecute, TOSS_ENDPOINTS.promotionResult]);
      paths.length = 0;
      await handleRequest(request("POST", PROMOTION_REWARD_STATUS_PATH, { ...body, providerTransactionKey: "transaction-key" }, { authorization: "Bearer secret" }), config);
      expect(paths).toEqual([TOSS_ENDPOINTS.promotionResult]);
      await expect(handleRequest(request("POST", PROXY_ENDPOINTS.promotionRewardGrant, { ...body, tossUserKey: "login-key" }, { authorization: "Bearer secret" }), config)).rejects.toThrow("provide exactly one promotion recipient");
    });
  });

  test("stub iap order status returns payable status", async () => {
    const req = request("POST", PROXY_ENDPOINTS.iapOrderStatus, {
      orderId: "order-1",
      sku: "loo.credits.50",
    });
    const res = await handleRequest(req, { mode: "stub", internalToken: "" });
    expect(res.body.ok).toBe(true);
    expect(res.body.orderId).toBe("order-1");
    expect(res.body.sku).toBe("loo.credits.50");
    expect(res.body.providerStatus).toBe("PAYMENT_COMPLETED");
  });

  for (const paidStatus of ["PAYMENT_COMPLETED", "PURCHASED"]) {
  test(`forward iap rejects ${paidStatus} without provider SKU`, async () => {
    const upstreamServer = http.createServer((req, res) => {
      req.resume();
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          resultType: "SUCCESS",
          success: {
            orderId: "order-1",
            status: paidStatus,
          },
        }),
      );
    });
    await withServer(upstreamServer, async (upstreamBaseUrl) => {
      const req = request(
        "POST",
        PROXY_ENDPOINTS.iapOrderStatus,
        {
          orderId: "order-1",
          sku: "loo.credits.50",
          tossUserKey: "toss-user-1",
        },
        { authorization: "Bearer secret" },
      );
      const res = await handleRequest(req, {
        mode: "forward",
        internalToken: "secret",
        upstreamBaseUrl,
      });
      expect(res.body.ok).toBe(false);
      expect(res.body.orderId).toBe("order-1");
      expect(res.body.sku).toBeUndefined();
      expect(res.body.error).toBe("UNVERIFIED_IAP_ORDER");
      expect(res.body.providerStatus).toBe("ERROR");
    });
  });
  }

  test("forward IAP uses the provider SKU even when the request names a more valuable product", async () => {
    const upstream = http.createServer((req, res) => {
      req.resume();
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ resultType: "SUCCESS", success: {
        orderId: "order-1", sku: "cheap-product", status: "PURCHASED",
      } }));
    });
    await withServer(upstream, async (upstreamBaseUrl) => {
      const result = await handleRequest(request("POST", PROXY_ENDPOINTS.iapOrderStatus,
        { orderId: "order-1", sku: "expensive-product", tossUserKey: "synthetic-user" },
        { authorization: "Bearer secret" }), { mode: "forward", internalToken: "secret", upstreamBaseUrl });
      expect(result.body.ok).toBe(true);
      expect(result.body.sku).toBe("cheap-product");
    });
  });

  test("forward iap order status retries transient provider statuses", async () => {
    let hitCount = 0;
    const upstreamServer = http.createServer((req, res) => {
      req.resume();
      hitCount += 1;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          resultType: "SUCCESS",
          success: {
            orderId: "order-1",
            sku: "loo.credits.50",
            status: hitCount === 1 ? "ORDER_IN_PROGRESS" : "PAYMENT_COMPLETED",
          },
        }),
      );
    });
    await withServer(upstreamServer, async (upstreamBaseUrl) => {
      const req = request(
        "POST",
        PROXY_ENDPOINTS.iapOrderStatus,
        {
          orderId: "order-1",
          sku: "loo.credits.50",
          tossUserKey: "toss-user-1",
        },
        { authorization: "Bearer secret" },
      );
      const res = await handleRequest(req, {
        mode: "forward",
        internalToken: "secret",
        upstreamBaseUrl,
        iapOrderStatusMaxAttempts: 2,
        iapOrderStatusRetryDelayMs: 0,
      });
      expect(hitCount).toBe(2);
      expect(res.body.ok).toBe(true);
      expect(res.body.sku).toBe("loo.credits.50");
      expect(res.body.providerStatus).toBe("PAYMENT_COMPLETED");
      expect(res.body.attempts).toBe(2);
    });
  });

  test("forward message normalizes official Toss success response counts", async () => {
    let upstreamBody;
    let upstreamUserKey;
    const upstreamServer = http.createServer(async (req, res) => {
      upstreamUserKey = req.headers["x-toss-user-key"];
      upstreamBody = await readRequestJson(req);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          resultType: "SUCCESS",
          result: {
            msgCount: 1,
            sentPushCount: 1,
            sentInboxCount: 0,
            detail: {
              sentPush: [{ contentId: "toss:PUSH:1" }],
              sentInbox: [],
            },
            fail: {
              sentPush: [],
              sentInbox: [],
            },
          },
        }),
      );
    });
    await withServer(upstreamServer, async (upstreamBaseUrl) => {
      const req = request(
        "POST",
        PROXY_ENDPOINTS.smartMessageSend,
        {
          providerRequestId: "msg-1",
          templateSetCode: "reward_result",
          context: { point: "100" },
          tossUserKey: "toss-user-1",
          requestedAt: 1234,
        },
        { authorization: "Bearer secret" },
      );
      const res = await handleRequest(req, {
        mode: "forward",
        internalToken: "secret",
        upstreamBaseUrl,
      });
      expect(upstreamUserKey).toBe("toss-user-1");
      expect(upstreamBody.tossUserKey).toBeUndefined();
      expect(res.body.ok).toBe(true);
      expect(res.body.providerStatus).toBe("SENT");
      expect(res.body.resultType).toBe("SUCCESS");
      expect(res.body.msgCount).toBe(1);
      expect(res.body.sentPushCount).toBe(1);
      expect(res.body.sentInboxCount).toBe(0);
      expect(res.body.contentIds).toEqual(["toss:PUSH:1"]);
    });
  });

  test("anonymous messages send only x-anon-key and never return the recipient", async () => {
    let upstreamHeaders;
    let upstreamBody;
    const upstreamServer = http.createServer(async (req, res) => {
      upstreamHeaders = req.headers;
      upstreamBody = await readRequestJson(req);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ resultType: "SUCCESS", success: { msgCount: 1 } }));
    });
    await withServer(upstreamServer, async (upstreamBaseUrl) => {
      const res = await handleRequest(request("POST", PROXY_ENDPOINTS.smartMessageSend, {
        anonKey: "anonymous-test-recipient", templateSetCode: "reminder", context: {},
      }, { authorization: "Bearer secret" }), { mode: "forward", internalToken: "secret", upstreamBaseUrl });
      expect(upstreamHeaders["x-anon-key"]).toBe("anonymous-test-recipient");
      expect(upstreamHeaders["x-user-key"]).toBeUndefined();
      expect(upstreamHeaders["x-toss-user-key"]).toBeUndefined();
      expect(upstreamBody).toEqual({ templateSetCode: "reminder", context: {} });
      expect(res.body.ok).toBe(true);
      expect(JSON.stringify(res.body)).not.toContain("anonymous-test-recipient");
    });
  });

  test("forward messages reject ambiguous recipients before calling upstream", async () => {
    await expect(handleRequest(request("POST", PROXY_ENDPOINTS.smartMessageSend, {
      tossUserKey: "login-recipient", anonKey: "anonymous-recipient", templateSetCode: "reminder", context: {},
    }, { authorization: "Bearer secret" }), { mode: "forward", internalToken: "secret" }))
      .rejects.toThrow("at most one of userKey, tossUserKey, or anonKey");
  });

  test("generic relay still requires the configured internal token", async () => {
    const result = await handleRequest(request("POST", PROXY_ENDPOINTS.genericMtlRequest, {
      path: "/private", method: "POST", body: {},
    }), { mode: "forward", internalToken: "secret" });
    expect(result.status).toBe(401);
  });

  test("forward bulk message targets Toss bulk API with sanitized context list", async () => {
    let upstreamBody;
    let upstreamUserKey;
    let upstreamPath;
    const upstreamServer = http.createServer(async (req, res) => {
      upstreamPath = req.url;
      upstreamUserKey = req.headers["x-toss-user-key"];
      upstreamBody = await readRequestJson(req);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          resultType: "SUCCESS",
          success: {
            msgCount: 2,
            sentPushCount: 2,
            sentInboxCount: 0,
            detail: {
              sentPush: [{ contentId: "toss:PUSH:1" }, { contentId: "toss:PUSH:2" }],
              sentInbox: [],
            },
            fail: {
              sentPush: [],
              sentInbox: [],
            },
          },
        }),
      );
    });
    await withServer(upstreamServer, async (upstreamBaseUrl) => {
      const req = request(
        "POST",
        PROXY_ENDPOINTS.smartMessageBulkSend,
        {
          providerRequestId: "bulk-1",
          templateSetCode: "mission_daily_status_v1",
          purpose: "FUNCTIONAL",
          contextList: [
            {
              messageId: "message-1",
              userId: "user-1",
              idempotencyKey: "idem-1",
              tossUserKey: "toss-user-1",
              context: { correctCount: 1 },
            },
            {
              messageId: "message-2",
              userId: "user-2",
              idempotencyKey: "idem-2",
              userKey: "toss-user-2",
              context: { correctCount: 2 },
            },
          ],
          requestedAt: 1234,
        },
        { authorization: "Bearer secret" },
      );
      const res = await handleRequest(req, {
        mode: "forward",
        internalToken: "secret",
        upstreamBaseUrl,
      });

      expect(upstreamPath).toBe(TOSS_ENDPOINTS.messageBulkSend);
      expect(upstreamUserKey).toBeUndefined();
      expect(upstreamBody).toEqual({
        templateSetCode: "mission_daily_status_v1",
        contextList: [
          { userKey: "toss-user-1", context: { correctCount: 1 } },
          { userKey: "toss-user-2", context: { correctCount: 2 } },
        ],
      });
      expect(res.body.ok).toBe(true);
      expect(res.body.providerStatus).toBe("SENT");
      expect(res.body.resultType).toBe("SUCCESS");
      expect(res.body.msgCount).toBe(2);
      expect(res.body.sentPushCount).toBe(2);
      expect(res.body.contentIds).toEqual(["toss:PUSH:1", "toss:PUSH:2"]);
    });
  });

  test("forward message treats non-2xx upstream responses as failed", async () => {
    const upstreamServer = http.createServer((req, res) => {
      req.resume();
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ message: "upstream unavailable", errorCode: "UPSTREAM_500" }));
    });
    await withServer(upstreamServer, async (upstreamBaseUrl) => {
      const req = request(
        "POST",
        PROXY_ENDPOINTS.smartMessageSend,
        {
          providerRequestId: "msg-http-500",
          templateSetCode: "reward_result",
          context: {},
          tossUserKey: "toss-user-1",
          requestedAt: 1234,
        },
        { authorization: "Bearer secret" },
      );
      const res = await handleRequest(req, {
        mode: "forward",
        internalToken: "secret",
        upstreamBaseUrl,
      });

      expect(res.body.ok).toBe(false);
      expect(res.body.providerStatus).toBe("FAILED");
      expect(res.body.failureReason).toBe("upstream unavailable");
      expect(res.body.providerErrorCode).toBe("UPSTREAM_500");
      expect(res.body.upstreamStatus).toBe(500);
    });
  });

  test("forward bulk message treats raw non-2xx upstream responses as failed", async () => {
    const upstreamServer = http.createServer((req, res) => {
      req.resume();
      res.writeHead(502, { "content-type": "text/plain" });
      res.end("bad gateway");
    });
    await withServer(upstreamServer, async (upstreamBaseUrl) => {
      const req = request(
        "POST",
        PROXY_ENDPOINTS.smartMessageBulkSend,
        {
          providerRequestId: "bulk-http-502",
          templateSetCode: "mission_daily_status_v1",
          contextList: [{ userKey: "toss-user-1", context: {} }],
          requestedAt: 1234,
        },
        { authorization: "Bearer secret" },
      );
      const res = await handleRequest(req, {
        mode: "forward",
        internalToken: "secret",
        upstreamBaseUrl,
      });

      expect(res.body.ok).toBe(false);
      expect(res.body.providerStatus).toBe("FAILED");
      expect(res.body.failureReason).toBe("bad gateway");
      expect(res.body.upstreamStatus).toBe(502);
    });
  });

  test("bulk message rejects context lists over Toss limit", async () => {
    const req = request("POST", PROXY_ENDPOINTS.smartMessageBulkSend, {
      providerRequestId: "bulk-too-large",
      templateSetCode: "mission_daily_status_v1",
      contextList: Array.from({ length: SMART_MESSAGE_BULK_MAX_CONTEXTS + 1 }, (_, index) => ({
        userKey: `toss-user-${index}`,
        context: {},
      })),
    });

    await expect(handleRequest(req, { mode: "stub", internalToken: "" })).rejects.toThrow(
      "contextList supports at most 2500 recipients",
    );
  });

  test("forward message maps official Toss failure response", async () => {
    const upstreamServer = http.createServer((req, res) => {
      req.resume();
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          resultType: "FAIL",
          error: {
            errorCode: "INVALID_TEMPLATE",
            reason: "template is not approved",
          },
        }),
      );
    });
    await withServer(upstreamServer, async (upstreamBaseUrl) => {
      const req = request(
        "POST",
        PROXY_ENDPOINTS.smartMessageSend,
        {
          providerRequestId: "msg-2",
          templateSetCode: "reward_result",
          context: {},
          tossUserKey: "toss-user-1",
        },
        { authorization: "Bearer secret" },
      );
      const res = await handleRequest(req, {
        mode: "forward",
        internalToken: "secret",
        upstreamBaseUrl,
      });
      expect(res.body.ok).toBe(false);
      expect(res.body.providerStatus).toBe("FAILED");
      expect(res.body.resultType).toBe("FAIL");
      expect(res.body.providerErrorCode).toBe("INVALID_TEMPLATE");
      expect(res.body.failureReason).toBe("template is not approved");
    });
  });

  test("forward message keeps partial delivery as sent while exposing reach failures", async () => {
    const upstreamServer = http.createServer((req, res) => {
      req.resume();
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          resultType: "SUCCESS",
          result: {
            msgCount: 1,
            sentPushCount: 1,
            sentInboxCount: 0,
            detail: {
              sentPush: [{ contentId: "toss:PUSH:2" }],
              sentInbox: [],
            },
            fail: {
              sentPush: [],
              sentInbox: [{ contentId: "toss:INBOX:2", reachFailReason: "사용자 알림함 도달 실패" }],
            },
          },
        }),
      );
    });
    await withServer(upstreamServer, async (upstreamBaseUrl) => {
      const req = request(
        "POST",
        PROXY_ENDPOINTS.smartMessageSend,
        {
          providerRequestId: "msg-3",
          templateSetCode: "reward_result",
          context: {},
          tossUserKey: "toss-user-1",
        },
        { authorization: "Bearer secret" },
      );
      const res = await handleRequest(req, {
        mode: "forward",
        internalToken: "secret",
        upstreamBaseUrl,
      });
      expect(res.body.ok).toBe(true);
      expect(res.body.providerStatus).toBe("SENT");
      expect(res.body.failureReason).toBe("사용자 알림함 도달 실패");
      expect(res.body.failures).toEqual([
        {
          channel: "sentInbox",
          contentId: "toss:INBOX:2",
          reachFailReason: "사용자 알림함 도달 실패",
          reachedFailReason: "사용자 알림함 도달 실패",
        },
      ]);
    });
  });

  test("forward message infers failed passthrough status when ok is omitted", async () => {
    const upstreamServer = http.createServer((req, res) => {
      req.resume();
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          providerRequestId: "msg-4",
          providerStatus: "FAILED",
          failureReason: "provider rejected message",
        }),
      );
    });
    await withServer(upstreamServer, async (upstreamBaseUrl) => {
      const req = request(
        "POST",
        PROXY_ENDPOINTS.smartMessageSend,
        {
          providerRequestId: "msg-4",
          templateSetCode: "reward_result",
          context: {},
          tossUserKey: "toss-user-1",
        },
        { authorization: "Bearer secret" },
      );
      const res = await handleRequest(req, {
        mode: "forward",
        internalToken: "secret",
        upstreamBaseUrl,
      });
      expect(res.body.ok).toBe(false);
      expect(res.body.providerStatus).toBe("FAILED");
      expect(res.body.failureReason).toBe("provider rejected message");
    });
  });

  test("message adapter targets the Toss messenger API", () => {
    expect(TOSS_ENDPOINTS.loginRemoveByUserKey).toBe(
      "/api-partner/v1/apps-in-toss/user/oauth2/access/remove-by-user-key",
    );
    expect(TOSS_ENDPOINTS.messageSend).toBe("/api-partner/v1/apps-in-toss/messenger/send-message");
    expect(TOSS_ENDPOINTS.messageBulkSend).toBe("/api-partner/v1/apps-in-toss/messenger/send-bulk-message");
  });

  test("adapter routes use Apps in Toss feature names", () => {
    expect(PROXY_ENDPOINTS.tossLoginComplete).toBe("/internal/apps-in-toss/toss-login/complete");
    expect(PROXY_ENDPOINTS.tossLoginRemoveByUserKey).toBe("/internal/apps-in-toss/toss-login/remove-by-user-key");
    expect(PROXY_ENDPOINTS.iapOrderStatus).toBe("/internal/apps-in-toss/iap/order/status");
    expect(PROXY_ENDPOINTS.promotionRewardGrant).toBe("/internal/apps-in-toss/promotion/reward/grant");
    expect(PROXY_ENDPOINTS.smartMessageSend).toBe("/internal/apps-in-toss/smart-message/send");
    expect(PROXY_ENDPOINTS.smartMessageBulkSend).toBe("/internal/apps-in-toss/smart-message/send-bulk");
  });
});

function request(method, url, body = undefined, headers = {}) {
  const stream = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
  stream.method = method;
  stream.url = url;
  stream.headers = headers;
  return stream;
}

function readRequestJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
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

async function waitFor(predicate, timeoutMs = 5_000) {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("Timed out waiting for condition");
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
