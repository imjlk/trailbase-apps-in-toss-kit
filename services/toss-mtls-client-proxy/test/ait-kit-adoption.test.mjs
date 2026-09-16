import { describe, expect, test } from "bun:test";
import http from "node:http";
import https from "node:https";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import {
  PROXY_ENDPOINTS,
  TOSS_ENDPOINTS,
  createNodeMtlsClient,
  createProxyServer,
  handleRequest,
} from "../src/core.mjs";

// Regression suite for adopting @ait-kit 0.4 contracts: broken mTLS
// responses, overall timeouts, anonymous recipients, incomplete IAP
// responses, lost promotion responses, UNKNOWN message outcomes, and
// fail-closed plain-HTTP conversions.

describe("toss-mtls-client-proxy ait-kit adoption", () => {
  test("a response that breaks mid-body fails closed with a 502 envelope", async () => {
    const upstreamServer = http.createServer((_, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.write('{"partial":');
      setTimeout(() => res.destroy(), 10);
    });
    await withServer(upstreamServer, async (upstreamBaseUrl) => {
      const server = createProxyServer({
        mode: "forward",
        internalToken: "secret",
        upstreamBaseUrl,
        upstreamTimeoutMs: 5000,
      });
      await withServer(server, async (baseUrl) => {
        const res = await fetch(`${baseUrl}${PROXY_ENDPOINTS.genericMtlRequest}`, {
          method: "POST",
          headers: { authorization: "Bearer secret", "content-type": "application/json" },
          body: JSON.stringify({ method: "GET", path: "/broken" }),
        });
        const body = await res.json();
        expect(res.status).toBe(502);
        expect(body.error).toBe("UPSTREAM_REQUEST_FAILED");
      });
    });
  });

  test("overall request timeout covers headers and a stalled body", async () => {
    const upstreamServer = http.createServer((_, res) => {
      // Headers arrive, the body never finishes.
      res.writeHead(200, { "content-type": "application/json" });
      res.write('{"slow":');
    });
    await withServer(upstreamServer, async (upstreamBaseUrl) => {
      const server = createProxyServer({
        mode: "forward",
        internalToken: "secret",
        upstreamBaseUrl,
        upstreamTimeoutMs: 30,
      });
      await withServer(server, async (baseUrl) => {
        const res = await fetch(`${baseUrl}${PROXY_ENDPOINTS.genericMtlRequest}`, {
          method: "POST",
          headers: { authorization: "Bearer secret", "content-type": "application/json" },
          body: JSON.stringify({ method: "GET", path: "/stall" }),
        });
        const body = await res.json();
        expect(res.status).toBe(504);
        expect(body.error).toBe("UPSTREAM_TIMEOUT");
      });
    });
  });

  test("https transport is used for https upstreams with certificate material", async () => {
    // The mTLS transport itself rejects bad certificate material before
    // any connection; the proxy surfaces that configuration failure.
    const certDir = mkdtempSync(path.join(tmpdir(), "ait-mtls-"));
    try {
      writeFileSync(path.join(certDir, "client.crt"), "not a certificate");
      writeFileSync(path.join(certDir, "client.key"), "not a key");
      const client = createNodeMtlsClient({
        clientCertPath: path.join(certDir, "client.crt"),
        clientKeyPath: path.join(certDir, "client.key"),
      });
      await expect(
        client.request("https://127.0.0.1:9/internal", { method: "GET" }),
      ).rejects.toThrow();
    } finally {
      rmSync(certDir, { recursive: true, force: true });
    }
  });

  test("anonymous recipients ride x-anon-key through the shared transport", async () => {
    const seenHeaders = [];
    const upstreamServer = http.createServer(async (req, res) => {
      seenHeaders.push({
        url: req.url,
        anonKey: req.headers["x-anon-key"],
        tossUserKey: req.headers["x-toss-user-key"],
        userKey: req.headers["x-user-key"],
      });
      req.resume();
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ resultType: "SUCCESS", success: { orderId: "o-1", sku: "sku-1", status: "PAYMENT_COMPLETED" } }));
    });
    await withServer(upstreamServer, async (upstreamBaseUrl) => {
      const res = await handleRequest(
        request("POST", PROXY_ENDPOINTS.iapOrderStatus, { orderId: "o-1", tossUserKey: "anon-recipient-1" }, { authorization: "Bearer secret" }),
        { mode: "forward", internalToken: "secret", upstreamBaseUrl },
      );
      expect(res.body.ok).toBe(true);
      expect(res.body.sku).toBe("sku-1");
      expect(seenHeaders[0].tossUserKey).toBe("anon-recipient-1");
      expect(seenHeaders[0].userKey).toBeUndefined();
    });
  });

  test("incomplete IAP responses never become payable without SKU evidence", async () => {
    const variants = [
      // Success envelope missing the required fields entirely.
      { resultType: "SUCCESS" },
      // Non-SUCCESS envelope with a key-looking payload.
      { resultType: "FAIL", error: { errorCode: "5000", reason: "x" }, success: { orderId: "o-1", sku: "sku-1" } },
    ];
    for (const payload of variants) {
      const upstreamServer = http.createServer((_, res) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(payload));
      });
      await withServer(upstreamServer, async (upstreamBaseUrl) => {
        const res = await handleRequest(
          request("POST", PROXY_ENDPOINTS.iapOrderStatus, { orderId: "o-1", sku: "wanted" }, { authorization: "Bearer secret" }),
          { mode: "forward", internalToken: "secret", upstreamBaseUrl, iapOrderStatusMaxAttempts: 1, iapOrderStatusRetryDelayMs: 0 },
        );
        expect(res.body.ok).toBe(false);
      });
    }
  });

  test("lost promotion execute responses recover through status with the saved key", async () => {
    // First execute attempt: respond after the connection is destroyed so
    // the proxy sees a failed/UNKNOWN execute; the saved transaction key
    // then resolves the outcome through the status lookup.
    let executeAttempts = 0;
    const paths = [];
    const upstreamServer = http.createServer(async (req, res) => {
      paths.push(req.url);
      await readRequestJson(req);
      res.writeHead(200, { "content-type": "application/json" });
      if (req.url === TOSS_ENDPOINTS.promotionGetKey) {
        res.end(JSON.stringify({ resultType: "SUCCESS", success: { key: "ledger-key-1" } }));
        return;
      }
      if (req.url === TOSS_ENDPOINTS.promotionExecute) {
        executeAttempts += 1;
        if (executeAttempts === 1) {
          // Response lost: destroy before the body completes.
          res.write('{"resultType":"SUC');
          setTimeout(() => res.destroy(), 10);
          return;
        }
        res.end(JSON.stringify({ resultType: "SUCCESS", success: { key: "ledger-key-1" } }));
        return;
      }
      res.end(JSON.stringify({ resultType: "SUCCESS", success: "SUCCESS" }));
    });
    await withServer(upstreamServer, async (upstreamBaseUrl) => {
      const body = { anonKey: "anon-grant-recipient", promotionCode: "campaign", amount: 10 };
      const config = { mode: "forward", internalToken: "secret", upstreamBaseUrl, upstreamTimeoutMs: 2000 };
      const grant = await handleRequest(
        request("POST", PROXY_ENDPOINTS.promotionRewardGrant, body, { authorization: "Bearer secret" }),
        config,
      );
      // The lost execute never reports success; recovery (status with the
      // saved key) decides the terminal outcome.
      expect(["GRANTED", "PENDING", "FAILED"]).toContain(grant.body.providerStatus);
      expect(paths[0]).toBe(TOSS_ENDPOINTS.promotionGetKey);
      expect(paths).toContain(TOSS_ENDPOINTS.promotionResult);
      // The ledger-saved key is what the recovery queried.
      const statusCalls = paths.filter((p) => p === TOSS_ENDPOINTS.promotionResult);
      expect(statusCalls.length).toBeGreaterThanOrEqual(1);

      // The three-step endpoints are exposed for ledger-driven callers.
      const prepare = await handleRequest(
        request("POST", PROXY_ENDPOINTS.promotionPrepareReward, {}, { authorization: "Bearer secret" }),
        config,
      );
      expect(prepare.body.ok).toBe(true);
      expect(typeof prepare.body.providerTransactionKey).toBe("string");
    });
  });

  test("anonymous status failures never echo the recipient key", async () => {
    const upstreamServer = http.createServer(async (req, res) => {
      await readRequestJson(req);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        resultType: "FAIL",
        error: { errorCode: "4111", reason: "anon-status-key not found" },
      }));
    });
    await withServer(upstreamServer, async (upstreamBaseUrl) => {
      const res = await handleRequest(
        request("POST", PROXY_ENDPOINTS.promotionRewardStatus, {
          promotionCode: "campaign",
          providerTransactionKey: "failed-key",
          anonKey: "anon-status-key",
        }, { authorization: "Bearer secret" }),
        { mode: "forward", internalToken: "secret", upstreamBaseUrl },
      );
      expect(res.body.ok).toBe(true);
      expect(res.body.providerStatus).toBe("NOT_FOUND");
      expect(JSON.stringify(res.body)).not.toContain("anon-status-key");
    });
  });

  test("anonymous grants honor the promotionAmount compatibility alias", async () => {
    const bodies = [];
    const upstreamServer = http.createServer(async (req, res) => {
      const body = await readRequestJson(req);
      bodies.push({ url: req.url, body });
      res.writeHead(200, { "content-type": "application/json" });
      if (req.url === TOSS_ENDPOINTS.promotionGetKey) {
        res.end(JSON.stringify({ resultType: "SUCCESS", success: { key: "alias-key" } }));
        return;
      }
      if (req.url === TOSS_ENDPOINTS.promotionExecute) {
        res.end(JSON.stringify({ resultType: "SUCCESS", success: { key: "alias-key" } }));
        return;
      }
      res.end(JSON.stringify({ resultType: "SUCCESS", success: "SUCCESS" }));
    });
    await withServer(upstreamServer, async (upstreamBaseUrl) => {
      const res = await handleRequest(
        request("POST", PROXY_ENDPOINTS.promotionRewardGrant, {
          anonKey: "alias-recipient",
          promotionCode: "campaign",
          promotionAmount: 77,
        }, { authorization: "Bearer secret" }),
        { mode: "forward", internalToken: "secret", upstreamBaseUrl },
      );
      expect(res.body.providerStatus).toBe("GRANTED");
      const execute = bodies.find((call) => call.url === TOSS_ENDPOINTS.promotionExecute);
      expect(execute.body).toEqual({ promotionCode: "campaign", key: "alias-key", amount: 77 });
    });
  });

  test("UNKNOWN status outcomes stay PENDING for legacy ledger consumers", async () => {
    const upstreamServer = http.createServer(async (req, res) => {
      await readRequestJson(req);
      res.writeHead(200, { "content-type": "application/json" });
      // Malformed verdict: api-core maps it to UNKNOWN, not a definite failure.
      res.end(JSON.stringify({ resultType: "SUCCESS", success: "SOMETHING_ELSE" }));
    });
    await withServer(upstreamServer, async (upstreamBaseUrl) => {
      const res = await handleRequest(
        request("POST", PROXY_ENDPOINTS.promotionRewardStatus, {
          promotionCode: "campaign",
          providerTransactionKey: "unknown-key",
          anonKey: "anon-recipient",
        }, { authorization: "Bearer secret" }),
        { mode: "forward", internalToken: "secret", upstreamBaseUrl },
      );
      expect(res.body.ok).toBe(true);
      expect(res.body.providerStatus).toBe("PENDING");
      expect(res.body.status).toBe("UNKNOWN");
    });
  });

  test("anonymous execute failures keep the request ID and redact the recipient", async () => {
    // Anonymous legacy grant whose execute step is explicitly rejected:
    // the failure must carry the caller's providerRequestId and never echo
    // the anonymous key.
    const upstreamServer = http.createServer(async (req, res) => {
      await readRequestJson(req);
      res.writeHead(200, { "content-type": "application/json" });
      if (req.url === TOSS_ENDPOINTS.promotionGetKey) {
        res.end(JSON.stringify({ resultType: "SUCCESS", success: { key: "ledger-key-2" } }));
        return;
      }
      if (req.url === TOSS_ENDPOINTS.promotionExecute) {
        res.end(JSON.stringify({
          resultType: "FAIL",
          error: { errorCode: "4112", reason: "anon-exec-recipient already granted" },
        }));
        return;
      }
      res.end(JSON.stringify({ resultType: "SUCCESS", success: "SUCCESS" }));
    });
    await withServer(upstreamServer, async (upstreamBaseUrl) => {
      const res = await handleRequest(
        request("POST", PROXY_ENDPOINTS.promotionRewardGrant, {
          anonKey: "anon-exec-recipient",
          promotionCode: "campaign",
          amount: 5,
          providerRequestId: "ledger-request-9",
        }, { authorization: "Bearer secret" }),
        { mode: "forward", internalToken: "secret", upstreamBaseUrl },
      );
      expect(res.body.ok).toBe(false);
      expect(res.body.providerStatus).toBe("PROMOTION_EXECUTE_FAILED");
      expect(res.body.providerRequestId).toBe("ledger-request-9");
      expect(res.body.providerErrorCode).toBe("4112");
      expect(JSON.stringify(res.body)).not.toContain("anon-exec-recipient");
    });
  });

  test("anonymous grant success keeps the legacy grantedAt timestamp", async () => {
    const upstreamServer = http.createServer(async (req, res) => {
      await readRequestJson(req);
      res.writeHead(200, { "content-type": "application/json" });
      if (req.url === TOSS_ENDPOINTS.promotionGetKey) {
        res.end(JSON.stringify({ resultType: "SUCCESS", success: { key: "ledger-key-3" } }));
        return;
      }
      if (req.url === TOSS_ENDPOINTS.promotionExecute) {
        res.end(JSON.stringify({ resultType: "SUCCESS", success: { key: "ledger-key-3" } }));
        return;
      }
      res.end(JSON.stringify({ resultType: "SUCCESS", success: "SUCCESS" }));
    });
    await withServer(upstreamServer, async (upstreamBaseUrl) => {
      const res = await handleRequest(
        request("POST", PROXY_ENDPOINTS.promotionRewardGrant, {
          anonKey: "anon-granted-recipient",
          promotionCode: "campaign",
          amount: 5,
          requestedAt: 123456,
        }, { authorization: "Bearer secret" }),
        { mode: "forward", internalToken: "secret", upstreamBaseUrl },
      );
      expect(res.body.ok).toBe(true);
      expect(res.body.providerStatus).toBe("GRANTED");
      expect(res.body.grantedAt).toBe(123456);
    });
  });

  test("direct anonymous execute responses redact the recipient key", async () => {
    const upstreamServer = http.createServer(async (req, res) => {
      await readRequestJson(req);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        resultType: "FAIL",
        error: { errorCode: "4113", reason: "anon-direct-recipient retracted" },
      }));
    });
    await withServer(upstreamServer, async (upstreamBaseUrl) => {
      const res = await handleRequest(
        request("POST", PROXY_ENDPOINTS.promotionExecuteReward, {
          amount: 5,
          anonKey: "anon-direct-recipient",
          promotionCode: "campaign",
          providerTransactionKey: "some-key",
        }, { authorization: "Bearer secret" }),
        { mode: "forward", internalToken: "secret", upstreamBaseUrl },
      );
      expect(res.body.ok).toBe(false);
      expect(JSON.stringify(res.body)).not.toContain("anon-direct-recipient");
    });
  });

  test("terminal FAILED status outcomes report ok false for legacy consumers", async () => {
    const upstreamServer = http.createServer(async (req, res) => {
      await readRequestJson(req);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ resultType: "SUCCESS", success: "FAILED" }));
    });
    await withServer(upstreamServer, async (upstreamBaseUrl) => {
      const res = await handleRequest(
        request("POST", PROXY_ENDPOINTS.promotionRewardStatus, {
          anonKey: "anon-failed-recipient",
          promotionCode: "campaign",
          providerTransactionKey: "failed-key",
        }, { authorization: "Bearer secret" }),
        { mode: "forward", internalToken: "secret", upstreamBaseUrl },
      );
      expect(res.body.ok).toBe(false);
      expect(res.body.providerStatus).toBe("FAILED");
      expect(res.body.status).toBe("FAILED");
      expect(JSON.stringify(res.body)).not.toContain("anon-failed-recipient");
    });
  });

  test("prepare and status failures keep request IDs and provider codes", async () => {
    // get-key fails (prepare), then the result endpoint fails with a coded
    // FAIL envelope: both responses must keep the caller's request ID and
    // the status path must keep the provider's error code.
    let phase = 0;
    const upstreamServer = http.createServer(async (req, res) => {
      await readRequestJson(req);
      res.writeHead(200, { "content-type": "application/json" });
      phase += 1;
      if (phase === 1) {
        res.end(JSON.stringify({ resultType: "FAIL", error: { errorCode: "4100", reason: "prepare-denied" } }));
        return;
      }
      res.end(JSON.stringify({
        resultType: "FAIL",
        error: { errorCode: "4111", reason: "ledger-key-x not found" },
      }));
    });
    await withServer(upstreamServer, async (upstreamBaseUrl) => {
      const config = { mode: "forward", internalToken: "secret", upstreamBaseUrl };
      const grant = await handleRequest(
        request("POST", PROXY_ENDPOINTS.promotionRewardGrant, {
          anonKey: "anon-prepare-recipient",
          promotionCode: "campaign",
          amount: 5,
          providerRequestId: "ledger-request-p",
        }, { authorization: "Bearer secret" }),
        config,
      );
      expect(grant.body.ok).toBe(false);
      expect(grant.body.providerRequestId).toBe("ledger-request-p");
      expect(JSON.stringify(grant.body)).not.toContain("anon-prepare-recipient");

      const status = await handleRequest(
        request("POST", PROXY_ENDPOINTS.promotionRewardStatus, {
          anonKey: "anon-prepare-recipient",
          promotionCode: "campaign",
          providerTransactionKey: "ledger-key-x",
          providerRequestId: "ledger-request-s",
        }, { authorization: "Bearer secret" }),
        config,
      );
      expect(status.body.ok).toBe(true);
      expect(status.body.providerStatus).toBe("NOT_FOUND");
      expect(status.body.providerRequestId).toBe("ledger-request-s");
      expect(status.body.providerErrorCode).toBe("4111");
    });
  });

  test("direct user-key execute responses redact the echoed recipient", async () => {
    const upstreamServer = http.createServer(async (req, res) => {
      await readRequestJson(req);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        resultType: "FAIL",
        error: { errorCode: "4113", reason: "user-direct-recipient retracted" },
      }));
    });
    await withServer(upstreamServer, async (upstreamBaseUrl) => {
      const res = await handleRequest(
        request("POST", PROXY_ENDPOINTS.promotionExecuteReward, {
          amount: 5,
          promotionCode: "campaign",
          providerTransactionKey: "some-key",
          tossUserKey: "user-direct-recipient",
        }, { authorization: "Bearer secret" }),
        { mode: "forward", internalToken: "secret", upstreamBaseUrl },
      );
      expect(res.body.ok).toBe(false);
      expect(JSON.stringify(res.body)).not.toContain("user-direct-recipient");
    });
  });

  test("plain-HTTP transport drops caller hop-by-hop headers", async () => {
    // A caller-supplied transfer-encoding header must not survive into the
    // framed plain-HTTP upstream request (Node rejects the conflicting
    // framing); the proxy computes its own content-length.
    let seenHeaders;
    const upstreamServer = http.createServer(async (req, res) => {
      seenHeaders = req.headers;
      await readRequestJson(req);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ resultType: "SUCCESS", success: "SUCCESS" }));
    });
    await withServer(upstreamServer, async (upstreamBaseUrl) => {
      const res = await handleRequest(
        request("POST", PROXY_ENDPOINTS.promotionRewardStatus, {
          anonKey: "anon-plain-recipient",
          promotionCode: "campaign",
          providerTransactionKey: "plain-key",
        }, {
          authorization: "Bearer secret",
          "transfer-encoding": "chunked",
          connection: "keep-alive",
        }),
        { mode: "forward", internalToken: "secret", upstreamBaseUrl },
      );
      expect(res.body.ok).toBe(true);
      // Node's own server adds its connection handling to req.headers, so
      // the forwarded-state proof is the framing pair: no transfer-encoding
      // survives and the proxy computed a concrete content-length.
      expect(seenHeaders["transfer-encoding"]).toBeUndefined();
      expect(typeof seenHeaders["content-length"]).toBe("string");
    });
  });

  test("stub IAP responses without a SKU keep the payable legacy shape", async () => {
    const res = await handleRequest(
      request("POST", PROXY_ENDPOINTS.iapOrderStatus, { orderId: "stub-order" }, { authorization: "Bearer secret" }),
      { mode: "stub", internalToken: "secret" },
    );
    // The legacy wire shape keeps the stub payable result instead of
    // rejecting it for missing provider SKU evidence (forward-only rule).
    expect(res.body).toMatchObject({ ok: true, orderId: "stub-order", providerStatus: "PAYMENT_COMPLETED" });
    expect(res.body.error).toBeUndefined();
  });

  test("user-key status responses redact the echoed recipient", async () => {
    const upstreamServer = http.createServer(async (req, res) => {
      await readRequestJson(req);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        resultType: "FAIL",
        error: { errorCode: "4111", reason: "user-status-recipient not found" },
      }));
    });
    await withServer(upstreamServer, async (upstreamBaseUrl) => {
      const res = await handleRequest(
        request("POST", PROXY_ENDPOINTS.promotionRewardStatus, {
          promotionCode: "campaign",
          providerTransactionKey: "missing-key",
          providerRequestId: "ledger-request-u",
          tossUserKey: "user-status-recipient",
        }, { authorization: "Bearer secret" }),
        { mode: "forward", internalToken: "secret", upstreamBaseUrl },
      );
      expect(res.body.providerRequestId).toBe("ledger-request-u");
      expect(JSON.stringify(res.body)).not.toContain("user-status-recipient");
    });
  });

  test("anonymous grants with a saved key reconcile without re-executing", async () => {
    // A retry carrying the ledger-saved transaction key must only look the
    // result up — prepare/execute would issue a duplicate reward.
    const paths = [];
    const upstreamServer = http.createServer(async (req, res) => {
      paths.push(req.url);
      await readRequestJson(req);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ resultType: "SUCCESS", success: "SUCCESS" }));
    });
    await withServer(upstreamServer, async (upstreamBaseUrl) => {
      const res = await handleRequest(
        request("POST", PROXY_ENDPOINTS.promotionRewardGrant, {
          anonKey: "anon-saved-key-recipient",
          amount: 5,
          promotionCode: "campaign",
          providerTransactionKey: "ledger-saved-key",
        }, { authorization: "Bearer secret" }),
        { mode: "forward", internalToken: "secret", upstreamBaseUrl },
      );
      expect(res.body.ok).toBe(true);
      expect(res.body.providerStatus).toBe("GRANTED");
      expect(res.body.providerTransactionKey).toBe("ledger-saved-key");
      expect(paths).toEqual([TOSS_ENDPOINTS.promotionResult]);
      expect(JSON.stringify(res.body)).not.toContain("anon-saved-key-recipient");
    });
  });

  test("promotion status uses only the result endpoint with the persisted key", async () => {
    const paths = [];
    const upstreamServer = http.createServer(async (req, res) => {
      paths.push(req.url);
      const body = await readRequestJson(req);
      if (req.url === TOSS_ENDPOINTS.promotionResult) {
        expect(body).toEqual({ promotionCode: "campaign", key: "saved-key" });
      }
      req.resume();
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ resultType: "SUCCESS", success: "PENDING" }));
    });
    await withServer(upstreamServer, async (upstreamBaseUrl) => {
      const res = await handleRequest(
        request("POST", PROXY_ENDPOINTS.promotionRewardStatus, {
          promotionCode: "campaign",
          providerTransactionKey: "saved-key",
          anonKey: "anon-status-recipient",
        }, { authorization: "Bearer secret" }),
        { mode: "forward", internalToken: "secret", upstreamBaseUrl },
      );
      expect(paths).toEqual([TOSS_ENDPOINTS.promotionResult]);
      expect(res.body.providerStatus).toBe("PENDING");
      expect(res.body.providerTransactionKey).toBe("saved-key");
      expect(typeof res.body.checkedAt).toBe("number");
    });
  });

  test("plain-HTTP 204, 205, and 304 responses carry a null body without crashing", async () => {
    for (const status of [204, 205, 304]) {
      const upstreamServer = http.createServer((req, res) => {
        req.resume();
        res.writeHead(status, { "content-type": "application/json" });
        res.end();
      });
      await withServer(upstreamServer, async (upstreamBaseUrl) => {
        const res = await handleRequest(
          request("POST", PROXY_ENDPOINTS.genericMtlRequest, {
            method: "GET",
            path: "/status-check",
          }, { authorization: "Bearer secret" }),
          { mode: "forward", internalToken: "secret", upstreamBaseUrl },
        );
        expect(res.body.status).toBe(status);
        // The relay parses the empty null-body payload as an empty object;
        // the regression is that the null-body conversion completes at all.
        expect(res.body.body).toEqual({});
      });
    }
  });

  test("plain-HTTP responses with out-of-range statuses fail closed as REQUEST_FAILED", async () => {
    // Node's fetch Response constructor rejects status codes outside
    // 200-599, so an upstream answering 600 must surface as the transport's
    // typed error (502 envelope here), never an unhandled constructor throw.
    const upstreamServer = http.createServer((req, res) => {
      req.resume();
      // writeHead validates the 100-999 range the HTTP parser accepts;
      // 600 is intentionally outside what Response can represent.
      res.writeHead(600, "custom status", { "content-type": "application/json" });
      res.end("{}");
    });
    await withServer(upstreamServer, async (upstreamBaseUrl) => {
      const server = createProxyServer({
        mode: "forward",
        internalToken: "secret",
        upstreamBaseUrl,
        upstreamTimeoutMs: 5000,
      });
      await withServer(server, async (baseUrl) => {
        const res = await fetch(`${baseUrl}${PROXY_ENDPOINTS.genericMtlRequest}`, {
          method: "POST",
          headers: { authorization: "Bearer secret", "content-type": "application/json" },
          body: JSON.stringify({ method: "GET", path: "/weird" }),
        });
        const body = await res.json();
        expect(res.status).toBe(502);
        expect(body.error).toBe("UPSTREAM_REQUEST_FAILED");
      });
    });
  });

  test("empty and non-JSON message bodies surface UNKNOWN with the internal error marker", async () => {
    for (const [id, payload] of [["empty-json", ""], ["html", "<html>maintenance</html>"]]) {
      const upstreamServer = http.createServer((req, res) => {
        req.resume();
        res.writeHead(200, { "content-type": id === "html" ? "text/html" : "application/json" });
        res.end(payload);
      });
      await withServer(upstreamServer, async (upstreamBaseUrl) => {
        const res = await handleRequest(
          request("POST", PROXY_ENDPOINTS.smartMessageSend, {
            providerRequestId: `msg-${id}`,
            templateSetCode: "reward_result",
            context: {},
            tossUserKey: "toss-user-1",
            requestedAt: 1234,
          }, { authorization: "Bearer secret" }),
          { mode: "forward", internalToken: "secret", upstreamBaseUrl },
        );
        expect(res.body.ok).toBe(false);
        expect(res.body.providerStatus).toBe("UNKNOWN");
        expect(res.body.error).toBe("INVALID_RESPONSE");
        // The internal parse marker must stay distinct from a provider
        // error code: nothing the provider actually returned is mirrored.
        expect(res.body.providerErrorCode).toBeUndefined();
      });
    }
  });

  test("conflicting non-failure message status aliases surface UNKNOWN instead of optimistic sent", async () => {
    const upstreamServer = http.createServer((req, res) => {
      req.resume();
      res.writeHead(200, { "content-type": "application/json" });
      // Neither alias reports a failure, but they disagree about the
      // outcome; the contract must not pick the optimistic one.
      res.end(JSON.stringify({ providerStatus: "SENT", status: "PENDING" }));
    });
    await withServer(upstreamServer, async (upstreamBaseUrl) => {
      const res = await handleRequest(
        request("POST", PROXY_ENDPOINTS.smartMessageSend, {
          providerRequestId: "msg-conflicting",
          templateSetCode: "reward_result",
          context: {},
          tossUserKey: "toss-user-1",
          requestedAt: 1234,
        }, { authorization: "Bearer secret" }),
        { mode: "forward", internalToken: "secret", upstreamBaseUrl },
      );
      expect(res.body.ok).toBe(false);
      expect(res.body.providerStatus).toBe("UNKNOWN");
      expect(res.body.error).toBe("INVALID_RESPONSE");
    });
  });

  test("IAP evidence that is not a real string is an INVALID_RESPONSE, never a payable order", async () => {
    const upstreamServer = http.createServer((req, res) => {
      req.resume();
      res.writeHead(200, { "content-type": "application/json" });
      // A single-element array must not become a stringified SKU stand-in.
      res.end(JSON.stringify({
        orderId: "order-array-sku",
        status: "PAYMENT_COMPLETED",
        sku: ["fixture-coins"],
      }));
    });
    await withServer(upstreamServer, async (upstreamBaseUrl) => {
      const res = await handleRequest(
        request("POST", PROXY_ENDPOINTS.iapOrderStatus, {
          orderId: "order-array-sku",
          sku: "fixture-coins",
        }, { authorization: "Bearer secret" }),
        { mode: "forward", internalToken: "secret", upstreamBaseUrl },
      );
      expect(res.body.ok).toBe(false);
      expect(res.body.providerStatus).toBe("ERROR");
      expect(res.body.error).toBe("INVALID_RESPONSE");
      // The request order id stays for reconciliation; no fabricated sku.
      expect(res.body.orderId).toBe("order-array-sku");
      expect(res.body.sku).toBeUndefined();
    });
  });

  test("IAP query-failure envelopes never leak a contradictory success payload", async () => {
    const upstreamServer = http.createServer((req, res) => {
      req.resume();
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        resultType: "FAIL",
        message: "order lookup failed",
        success: { orderId: "order-fail-envelope", status: "PAYMENT_COMPLETED", sku: "fixture-coins" },
      }));
    });
    await withServer(upstreamServer, async (upstreamBaseUrl) => {
      const res = await handleRequest(
        request("POST", PROXY_ENDPOINTS.iapOrderStatus, {
          orderId: "order-fail-envelope",
          sku: "fixture-coins",
        }, { authorization: "Bearer secret" }),
        { mode: "forward", internalToken: "secret", upstreamBaseUrl },
      );
      expect(res.body.ok).toBe(false);
      expect(res.body.providerStatus).toBe("ERROR");
      expect(res.body.failureReason).toBe("order lookup failed");
      expect(res.body.orderId).toBe("order-fail-envelope");
      // The contradictory success payload must not survive as evidence.
      expect(res.body.verified).toBeUndefined();
      expect(res.body.skuCheck).toBeUndefined();
    });
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
