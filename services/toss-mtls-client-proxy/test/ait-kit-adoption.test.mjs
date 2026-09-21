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
    // Ledger-driven three-step flow: prepare issues the key, the first
    // execute attempt loses its response (connection destroyed mid-body),
    // and the saved transaction key resolves the outcome through the status
    // lookup — never through a second execute.
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
        // Response lost: destroy before the body completes.
        res.write('{"resultType":"SUC');
        setTimeout(() => res.destroy(), 10);
        return;
      }
      res.end(JSON.stringify({ resultType: "SUCCESS", success: "SUCCESS" }));
    });
    await withServer(upstreamServer, async (upstreamBaseUrl) => {
      const recipient = { anonKey: "anon-grant-recipient" };
      const config = { mode: "forward", internalToken: "secret", upstreamBaseUrl, upstreamTimeoutMs: 2000 };
      const prepared = await handleRequest(
        request("POST", PROXY_ENDPOINTS.promotionPrepareReward, recipient, { authorization: "Bearer secret" }),
        config,
      );
      expect(prepared.body.ok).toBe(true);
      expect(prepared.body.providerTransactionKey).toBe("ledger-key-1");

      const executed = await handleRequest(
        request("POST", PROXY_ENDPOINTS.promotionExecuteReward, {
          ...recipient,
          promotionCode: "campaign",
          amount: 10,
          providerTransactionKey: prepared.body.providerTransactionKey,
        }, { authorization: "Bearer secret" }),
        config,
      );
      // The lost execute never reports success: the outcome is UNKNOWN with
      // the transaction key preserved for the status lookup.
      expect(executed.body.ok).toBe(true);
      expect(executed.body.result).toBe("UNKNOWN");
      expect(executed.body.providerTransactionKey).toBe("ledger-key-1");
      expect(paths).toEqual([TOSS_ENDPOINTS.promotionGetKey, TOSS_ENDPOINTS.promotionExecute]);

      const status = await handleRequest(
        request("POST", PROXY_ENDPOINTS.promotionRewardStatus, {
          ...recipient,
          promotionCode: "campaign",
          providerTransactionKey: prepared.body.providerTransactionKey,
        }, { authorization: "Bearer secret" }),
        config,
      );
      expect(status.body.ok).toBe(true);
      expect(status.body.status).toBe("GRANTED");
      expect(paths).toEqual([TOSS_ENDPOINTS.promotionGetKey, TOSS_ENDPOINTS.promotionExecute, TOSS_ENDPOINTS.promotionResult]);
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
      expect(res.body.status).toBe("NOT_FOUND");
      expect(JSON.stringify(res.body)).not.toContain("anon-status-key");
    });
  });

  test("execute honors the promotionAmount compatibility alias", async () => {
    const bodies = [];
    const upstreamServer = http.createServer(async (req, res) => {
      bodies.push({ url: req.url, body: await readRequestJson(req) });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ resultType: "SUCCESS", success: "SUCCESS" }));
    });
    await withServer(upstreamServer, async (upstreamBaseUrl) => {
      const res = await handleRequest(
        request("POST", PROXY_ENDPOINTS.promotionExecuteReward, {
          anonKey: "alias-recipient",
          promotionCode: "campaign",
          providerTransactionKey: "alias-key",
          promotionAmount: 77,
        }, { authorization: "Bearer secret" }),
        { mode: "forward", internalToken: "secret", upstreamBaseUrl },
      );
      expect(res.body.ok).toBe(true);
      expect(bodies).toEqual([{
        url: TOSS_ENDPOINTS.promotionExecute,
        body: { promotionCode: "campaign", key: "alias-key", amount: 77 },
      }]);
    });
  });

  test("UNKNOWN status outcomes pass through verbatim", async () => {
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
      // No legacy remap: the Rust ledger owns the pending classification.
      expect(res.body.ok).toBe(true);
      expect(res.body.status).toBe("UNKNOWN");
    });
  });

  test("direct execute failures carry the provider codes and redact the recipient", async () => {
    // The provider explicitly rejects the execute call (budget exhausted).
    // The failure keeps the provider's codes and the transaction key; the
    // caller correlates with its own ledger request id.
    const upstreamServer = http.createServer(async (req, res) => {
      await readRequestJson(req);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        resultType: "FAIL",
        error: { errorCode: "4112", reason: "anon-exec-recipient budget exhausted" },
      }));
    });
    await withServer(upstreamServer, async (upstreamBaseUrl) => {
      const res = await handleRequest(
        request("POST", PROXY_ENDPOINTS.promotionExecuteReward, {
          anonKey: "anon-exec-recipient",
          promotionCode: "campaign",
          amount: 5,
          providerTransactionKey: "ledger-key-2",
        }, { authorization: "Bearer secret" }),
        { mode: "forward", internalToken: "secret", upstreamBaseUrl },
      );
      expect(res.body.ok).toBe(false);
      expect(res.body.providerStatus).toBe("FAILED");
      expect(res.body.providerErrorCode).toBe("4112");
      expect(res.body.providerTransactionKey).toBe("ledger-key-2");
      expect(JSON.stringify(res.body)).not.toContain("anon-exec-recipient");
    });
  });

  test("granted status reports observation time, never a fabricated grantedAt", async () => {
    // The official result API supplies no grant timestamp: the contract
    // carries checkedAt (observation time) only.
    const upstreamServer = http.createServer(async (req, res) => {
      await readRequestJson(req);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ resultType: "SUCCESS", success: "SUCCESS" }));
    });
    await withServer(upstreamServer, async (upstreamBaseUrl) => {
      const res = await handleRequest(
        request("POST", PROXY_ENDPOINTS.promotionRewardStatus, {
          anonKey: "anon-granted-recipient",
          promotionCode: "campaign",
          providerTransactionKey: "ledger-key-3",
        }, { authorization: "Bearer secret" }),
        { mode: "forward", internalToken: "secret", upstreamBaseUrl },
      );
      expect(res.body.ok).toBe(true);
      expect(res.body.status).toBe("GRANTED");
      expect(typeof res.body.checkedAt).toBe("number");
      expect(res.body.grantedAt).toBeUndefined();
      expect(res.body.requestedAt).toBeUndefined();
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

  test("terminal FAILED status outcomes report the observed verdict verbatim", async () => {
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
      // A successful lookup can still observe a terminal FAILED verdict;
      // ok describes the lookup, status carries the outcome.
      expect(res.body.ok).toBe(true);
      expect(res.body.status).toBe("FAILED");
      expect(JSON.stringify(res.body)).not.toContain("anon-failed-recipient");
    });
  });

  test("prepare and status failures keep provider codes and the caller request id", async () => {
    // get-key fails (prepare), then the result endpoint answers 4111: the
    // status path keeps the caller's request id for correlation and the
    // provider's error code, and neither response echoes the recipient.
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
      const prepared = await handleRequest(
        request("POST", PROXY_ENDPOINTS.promotionPrepareReward, {
          anonKey: "anon-prepare-recipient",
        }, { authorization: "Bearer secret" }),
        config,
      );
      expect(prepared.body.ok).toBe(false);
      expect(prepared.body.providerErrorCode).toBe("4100");
      expect(JSON.stringify(prepared.body)).not.toContain("anon-prepare-recipient");

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
      expect(status.body.status).toBe("NOT_FOUND");
      expect(status.body.providerRequestId).toBe("ledger-request-s");
      expect(status.body.providerErrorCode).toBe("4111");
      expect(JSON.stringify(status.body)).not.toContain("anon-prepare-recipient");
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

  test("saved-key recovery through the status endpoint never re-executes", async () => {
    // A ledger retry carrying the saved transaction key must only look the
    // result up — prepare/execute would issue a duplicate reward. This is
    // the only recovery path now that the batch grant route is gone.
    const paths = [];
    const upstreamServer = http.createServer(async (req, res) => {
      paths.push(req.url);
      await readRequestJson(req);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ resultType: "SUCCESS", success: "SUCCESS" }));
    });
    await withServer(upstreamServer, async (upstreamBaseUrl) => {
      const res = await handleRequest(
        request("POST", PROXY_ENDPOINTS.promotionRewardStatus, {
          anonKey: "anon-saved-key-recipient",
          promotionCode: "campaign",
          providerTransactionKey: "ledger-saved-key",
        }, { authorization: "Bearer secret" }),
        { mode: "forward", internalToken: "secret", upstreamBaseUrl },
      );
      expect(res.body.ok).toBe(true);
      expect(res.body.status).toBe("GRANTED");
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
      expect(res.body.status).toBe("PENDING");
      expect(res.body.providerTransactionKey).toBe("saved-key");
      expect(typeof res.body.checkedAt).toBe("number");
    });
  });

  test("prepare failures echo-redact the submitted recipient", async () => {
    // The get-key rejection embeds the submitted anonymous key in its
    // failure reason; the prepare response must redact it like execute and
    // status do.
    const upstreamServer = http.createServer(async (req, res) => {
      await readRequestJson(req);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        resultType: "FAIL",
        error: { errorCode: "4100", reason: "recipient anon-prepare-recipient-key is not allowed" },
      }));
    });
    await withServer(upstreamServer, async (upstreamBaseUrl) => {
      const res = await handleRequest(
        request("POST", PROXY_ENDPOINTS.promotionPrepareReward, {
          anonKey: "anon-prepare-recipient-key",
        }, { authorization: "Bearer secret" }),
        { mode: "forward", internalToken: "secret", upstreamBaseUrl },
      );
      expect(res.body.ok).toBe(false);
      expect(res.body.providerErrorCode).toBe("4100");
      expect(JSON.stringify(res.body)).not.toContain("anon-prepare-recipient-key");
      expect(JSON.stringify(res.body)).toContain("[redacted]");
    });
  });

  test("numeric recipients never corrupt unrelated response fields", async () => {
    // A short numeric id must not feed the substring redactor: keys like
    // "key-1" and coded reasons stay intact when the recipient is 1.
    const upstreamServer = http.createServer(async (req, res) => {
      await readRequestJson(req);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        resultType: "FAIL",
        error: { errorCode: "4113", reason: "already granted for order 1 of user 1" },
      }));
    });
    await withServer(upstreamServer, async (upstreamBaseUrl) => {
      const res = await handleRequest(
        request("POST", PROXY_ENDPOINTS.promotionExecuteReward, {
          userKey: 1,
          promotionCode: "campaign",
          amount: 5,
          providerTransactionKey: "key-1",
        }, { authorization: "Bearer secret" }),
        { mode: "forward", internalToken: "secret", upstreamBaseUrl },
      );
      expect(res.body.ok).toBe(false);
      expect(res.body.providerTransactionKey).toBe("key-1");
      expect(res.body.providerErrorCode).toBe("4113");
      expect(res.body.failureReason).toBe("[redacted]");
    });
  });

  test("short string recipients skip substring redaction via the length gate", async () => {
    const upstreamServer = http.createServer(async (req, res) => {
      await readRequestJson(req);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        resultType: "FAIL",
        error: { errorCode: "4113", reason: "already granted for user 42" },
      }));
    });
    await withServer(upstreamServer, async (upstreamBaseUrl) => {
      const res = await handleRequest(
        request("POST", PROXY_ENDPOINTS.promotionExecuteReward, {
          tossUserKey: "42",
          promotionCode: "campaign",
          amount: 5,
          providerTransactionKey: "key-42",
        }, { authorization: "Bearer secret" }),
        { mode: "forward", internalToken: "secret", upstreamBaseUrl },
      );
      expect(res.body.providerErrorCode).toBe("4113");
      expect(res.body.failureReason).toBe("[redacted]");
    });
  });

  test("long string userKey recipients still get provider-echo redaction", async () => {
    const upstreamServer = http.createServer(async (req, res) => {
      await readRequestJson(req);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        resultType: "FAIL",
        error: { errorCode: "4100", reason: "recipient user-hash-abcdef123 is not allowed" },
      }));
    });
    await withServer(upstreamServer, async (upstreamBaseUrl) => {
      const res = await handleRequest(
        request("POST", PROXY_ENDPOINTS.promotionPrepareReward, {
          userKey: "user-hash-abcdef123",
        }, { authorization: "Bearer secret" }),
        { mode: "forward", internalToken: "secret", upstreamBaseUrl },
      );
      expect(res.body.ok).toBe(false);
      expect(JSON.stringify(res.body)).not.toContain("user-hash-abcdef123");
      expect(JSON.stringify(res.body)).toContain("[redacted]");
    });
  });

  for (const [label, recipientBody] of [
    ["as JSON numbers", { userKey: 4437311042 }],
    ["as string Toss user keys", { tossUserKey: "4437311042" }],
    ["as JSON-number Toss user keys", { tossUserKey: 4437311042 }],
  ]) {
    test(`long numeric recipients (${label}) stay redacted`, async () => {
      const upstreamServer = http.createServer(async (req, res) => {
        await readRequestJson(req);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({
          resultType: "FAIL",
          error: { errorCode: "4100", reason: "recipient 4437311042 is not allowed" },
        }));
      });
      await withServer(upstreamServer, async (upstreamBaseUrl) => {
        const res = await handleRequest(
          request("POST", PROXY_ENDPOINTS.promotionPrepareReward, recipientBody, { authorization: "Bearer secret" }),
          { mode: "forward", internalToken: "secret", upstreamBaseUrl },
        );
        expect(res.body.ok).toBe(false);
        expect(JSON.stringify(res.body)).not.toContain("4437311042");
        expect(JSON.stringify(res.body)).toContain("[redacted]");
      });
    });
  }

  test("a recipient spelling that fails validation still gets scrubbed after dispatch", async () => {
    // requireAnonymousKey rejects over-length keys, but the core already
    // dispatched: the completed response must come back scrubbed with the
    // raw value, not as an INVALID_ANONYMOUS_KEY error and not unredacted.
    const malformed = `anon-${"x".repeat(4100)}`;
    const upstreamServer = http.createServer(async (req, res) => {
      await readRequestJson(req);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        resultType: "FAIL",
        error: { errorCode: "4100", reason: `recipient ${malformed} is not allowed` },
      }));
    });
    await withServer(upstreamServer, async (upstreamBaseUrl) => {
      const res = await handleRequest(
        request("POST", PROXY_ENDPOINTS.promotionPrepareReward, {
          anonKey: malformed,
        }, { authorization: "Bearer secret" }),
        { mode: "forward", internalToken: "secret", upstreamBaseUrl },
      );
      expect(res.body.ok).toBe(false);
      expect(res.body.providerErrorCode).toBe("4100");
      expect(JSON.stringify(res.body)).not.toContain(malformed);
      expect(JSON.stringify(res.body)).toContain("[redacted]");
    });
  });

  test("all-digit recipients of gate-passing length skip substring redaction", async () => {
    // "12345678" would substring-match inside transaction keys and request
    // ids; the gate excludes all-digit candidates from rewriting.
    const upstreamServer = http.createServer(async (req, res) => {
      await readRequestJson(req);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        resultType: "FAIL",
        error: { errorCode: "4113", reason: "already granted for 12345678" },
      }));
    });
    await withServer(upstreamServer, async (upstreamBaseUrl) => {
      const res = await handleRequest(
        request("POST", PROXY_ENDPOINTS.promotionExecuteReward, {
          tossUserKey: "12345678",
          promotionCode: "campaign",
          amount: 5,
          providerTransactionKey: "tx-12345678-01",
        }, { authorization: "Bearer secret" }),
        { mode: "forward", internalToken: "secret", upstreamBaseUrl },
      );
      expect(res.body.providerTransactionKey).toBe("tx-12345678-01");
      expect(res.body.failureReason).toBe("[redacted]");
    });
  });

  for (const endpoint of [PROXY_ENDPOINTS.promotionPrepareReward, PROXY_ENDPOINTS.promotionExecuteReward, PROXY_ENDPOINTS.promotionRewardStatus]) {
    test(`short recipient free text is suppressed without corrupting codes: ${endpoint}`, async () => {
      const upstreamServer = http.createServer(async (req, res) => {
        await readRequestJson(req);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ resultType: "FAIL", error: { errorCode: "4113", reason: "recipient 1 not eligible" } }));
      });
      await withServer(upstreamServer, async (upstreamBaseUrl) => {
        const res = await handleRequest(request("POST", endpoint, {
          userKey: 1, promotionCode: "campaign", amount: 5,
          providerTransactionKey: "key-1", providerRequestId: "request-1",
        }, { authorization: "Bearer secret" }), { mode: "forward", internalToken: "secret", upstreamBaseUrl });
        expect(res.body.failureReason).toBe("[redacted]");
        expect(res.body.providerErrorCode).toBe("4113");
        if (endpoint !== PROXY_ENDPOINTS.promotionPrepareReward) expect(res.body.providerTransactionKey).toBe("key-1");
      });
    });
  }

  test("api-core privacy does not rewrite an error code equal to a short recipient", async () => {
    const upstreamServer = http.createServer(async (req, res) => {
      await readRequestJson(req);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ resultType: "FAIL", error: { errorCode: "4113", reason: "recipient 4113 rejected" } }));
    });
    await withServer(upstreamServer, async (upstreamBaseUrl) => {
      const res = await handleRequest(request("POST", PROXY_ENDPOINTS.promotionExecuteReward, {
        userKey: 4113, promotionCode: "campaign", amount: 5, providerTransactionKey: "key-4113",
      }, { authorization: "Bearer secret" }), { mode: "forward", internalToken: "secret", upstreamBaseUrl });
      expect(res.body.failureReason).toBe("[redacted]");
      expect(res.body.providerErrorCode).toBe("4113");
      expect(res.body.providerTransactionKey).toBe("key-4113");
    });
  });

  test("invalid numeric promotion recipients never reach the upstream", async () => {
    let calls = 0;
    const upstreamServer = http.createServer((_req, res) => {
      calls++;
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{}");
    });
    await withServer(upstreamServer, async (upstreamBaseUrl) => {
      for (const value of [1.5, Number.MAX_SAFE_INTEGER + 1]) {
        for (const endpoint of [PROXY_ENDPOINTS.promotionPrepareReward, PROXY_ENDPOINTS.promotionExecuteReward, PROXY_ENDPOINTS.promotionRewardStatus]) {
          await expect(handleRequest(request("POST", endpoint, {
            userKey: value, promotionCode: "campaign", amount: 5, providerTransactionKey: "key",
          }, { authorization: "Bearer secret" }), { mode: "forward", internalToken: "secret", upstreamBaseUrl }))
            .rejects.toMatchObject({ code: "INVALID_PROMOTION_RECIPIENT" });
        }
      }
      expect(calls).toBe(0);
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
