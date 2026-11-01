import { describe, expect, test } from "bun:test";
import {
  AdSkipClientError,
  adSkipEffectKey,
  createAdSkipRedemptionClient,
  createAdSkipRedemptionController,
  createAdSkipRequestId,
  isRetryableAdSkipError,
  normalizeAdSkipRedemptionReceipt,
  resolveAdSkipChoice,
  type AdSkipRedemptionReceipt,
  type AdSkipRedemptionRequest,
} from "../src/ad-skip";
import { mapStorage } from "./helpers";

const ALLOWED = ["generation_continue", "custom", "report"];

function receiptFor(
  request: AdSkipRedemptionRequest,
  overrides: Partial<AdSkipRedemptionReceipt> = {},
): AdSkipRedemptionReceipt {
  return {
    balance: 2,
    consumed: 1,
    context: request.context ?? "",
    createdAt: 10,
    opportunity: null,
    opportunityKey: request.opportunityKey,
    placement: request.placement,
    receiptId: "a".repeat(48),
    replayed: false,
    requestId: request.requestId,
    resolution: "TICKET",
    ...overrides,
  };
}

function httpError(status: number, code: string) {
  return Object.assign(new Error(code), {
    payload: { error: { code, message: code } },
    status,
  });
}

describe("receipt normalization", () => {
  const request = {
    context: "generation:req-1",
    opportunityKey: "cycle:4",
    placement: "generation_continue",
    requestId: "request-000000001",
  };

  test("accepts top-level or nested receipts for the exact request", () => {
    const receipt = receiptFor(request);
    expect(normalizeAdSkipRedemptionReceipt(receipt, request)).toEqual(receipt);
    expect(normalizeAdSkipRedemptionReceipt({ redemption: receipt }, request)).toEqual(receipt);
  });

  test("rejects mismatched, inconsistent or incomplete receipts", () => {
    for (const bad of [
      receiptFor({ ...request, requestId: "request-000000002" }),
      receiptFor(request, { context: "generation:req-2" }),
      receiptFor(request, { consumed: 0 }),
      receiptFor(request, { consumed: 0, resolution: "ALREADY_RESOLVED" }),
      receiptFor(request, { balance: -1 }),
      { ...receiptFor(request), receiptId: undefined },
      null,
    ]) {
      expect(() => normalizeAdSkipRedemptionReceipt(bad, request)).toThrow(AdSkipClientError);
    }
  });

  test("an already resolved receipt points at the original effect", () => {
    const original = receiptFor(request);
    const lateRequest = { ...request, requestId: "request-000000002" };
    const late = normalizeAdSkipRedemptionReceipt(
      receiptFor(lateRequest, {
        consumed: 0,
        opportunity: {
          opportunityKey: "cycle:4",
          placement: "generation_continue",
          reference: original.receiptId,
          resolution: "TICKET",
          resolvedAt: 10,
        },
        receiptId: "b".repeat(48),
        resolution: "ALREADY_RESOLVED",
      }),
      lateRequest,
    );
    expect(adSkipEffectKey(late)).toBe(adSkipEffectKey(original));
  });
});

test("client posts the normalized request and validates the response", async () => {
  const calls: Array<{ body: unknown; url: string }> = [];
  const client = createAdSkipRedemptionClient({
    baseUrl: "https://api.example.test/",
    fetcher: async (url, init) => {
      const body = JSON.parse(String(init.body));
      calls.push({ body, url });
      return new Response(JSON.stringify(receiptFor(body)), { status: 200 });
    },
    redeemEndpoint: "/api/app/v1/ad-skips/redeem",
  });
  const receipt = await client.redeem({
    opportunityKey: "cycle:4",
    placement: "custom",
    requestId: "request-000000001",
  });
  expect(receipt.consumed).toBe(1);
  expect(calls).toEqual([
    {
      body: {
        context: "",
        opportunityKey: "cycle:4",
        placement: "custom",
        requestId: "request-000000001",
      },
      url: "https://api.example.test/api/app/v1/ad-skips/redeem",
    },
  ]);
  await expect(
    client.redeem({ opportunityKey: "cycle 4", placement: "custom", requestId: "request-000000001" }),
  ).rejects.toThrow(AdSkipClientError);
  expect(calls.length).toBe(1);
});

test("only definitive server answers drop a pending request", () => {
  for (const status of [401, 408, 429, 500, 503]) {
    expect(isRetryableAdSkipError(httpError(status, "X"))).toBe(true);
  }
  for (const status of [400, 403, 409]) {
    expect(isRetryableAdSkipError(httpError(status, "X"))).toBe(false);
  }
  expect(isRetryableAdSkipError(new TypeError("Network request failed"))).toBe(true);
  expect(isRetryableAdSkipError(new AdSkipClientError({ code: "AD_SKIP_INVALID_REQUEST", message: "x" }))).toBe(false);
});

test("request IDs satisfy the server format", () => {
  for (let index = 0; index < 5; index += 1) {
    expect(createAdSkipRequestId()).toMatch(/^[A-Za-z0-9_-]{16,128}$/);
  }
});

describe("redemption controller", () => {
  function setup(redeem: (request: AdSkipRedemptionRequest) => Promise<AdSkipRedemptionReceipt>, storage = mapStorage()) {
    let sequence = 0;
    const controller = createAdSkipRedemptionController({
      createRequestId: () => `request-${String(++sequence).padStart(9, "0")}`,
      maxAttempts: 2,
      redeem,
      retryDelayMs: 0,
      sleep: async () => {},
      storage,
      storageKey: "app.adSkips",
      timeoutMs: 20,
    });
    return { controller, storage };
  }

  test("persists the request before sending and clears it on a receipt", async () => {
    const storage = mapStorage();
    let persistedBeforeSend = "";
    const { controller } = setup(async (request) => {
      persistedBeforeSend = storage.map.get("app.adSkips") ?? "";
      return receiptFor(request, { balance: 4 });
    }, storage);
    const outcome = await controller.redeem({ context: "generation:req-1", opportunityKey: "cycle:1", placement: "generation_continue" });
    expect(persistedBeforeSend).toContain("request-000000001");
    expect(outcome.status).toBe("resolved");
    expect(controller.getSnapshot().balance).toBe(4);
    expect(controller.getSnapshot().pending).toEqual([]);
    expect(controller.isBlocked("generation_continue", "cycle:1")).toBe(false);
  });

  test("a timeout retries with the same request ID", async () => {
    const seen: string[] = [];
    const { controller } = setup(async (request) => {
      seen.push(request.requestId);
      if (seen.length === 1) {
        return new Promise<AdSkipRedemptionReceipt>(() => {});
      }
      return receiptFor(request);
    });
    const outcome = await controller.redeem({ opportunityKey: "cycle:2", placement: "custom" });
    expect(outcome.status).toBe("resolved");
    expect(seen).toEqual(["request-000000001", "request-000000001"]);
  });

  test("an unknown result survives a restart and is rechecked with its original ID", async () => {
    const storage = mapStorage();
    const first = setup(async () => {
      throw new TypeError("Network request failed");
    }, storage);
    const outcome = await first.controller.redeem({ context: "generation:req-9", opportunityKey: "cycle:3", placement: "report" });
    expect(outcome.status).toBe("unknown");
    expect(first.controller.isBlocked("report", "cycle:3")).toBe(true);

    const seen: AdSkipRedemptionRequest[] = [];
    const restarted = setup(async (request) => {
      seen.push(request);
      return receiptFor(request, { replayed: true });
    }, storage);
    await restarted.controller.load();
    expect(restarted.controller.getSnapshot().pending.length).toBe(1);
    // Another tap reuses the stored ID and context instead of charging a new request.
    const retried = await restarted.controller.redeem({ context: "generation:req-10", opportunityKey: "cycle:3", placement: "report" });
    expect(retried.status).toBe("resolved");
    expect(seen.map((request) => [request.requestId, request.context])).toEqual([
      ["request-000000001", "generation:req-9"],
    ]);
    expect(await restarted.controller.retryPending()).toEqual([]);
  });

  test("a definitive rejection clears the request and reports the code", async () => {
    const { controller } = setup(async () => {
      throw httpError(409, "AD_SKIP_INSUFFICIENT_BALANCE");
    });
    controller.setBalance(1);
    const outcome = await controller.redeem({ opportunityKey: "cycle:4", placement: "generation_continue" });
    expect(outcome).toMatchObject({ code: "AD_SKIP_INSUFFICIENT_BALANCE", status: "rejected" });
    expect(controller.getSnapshot().balance).toBe(0);
    expect(controller.getSnapshot().pending).toEqual([]);
  });

  test("duplicate taps share one request", async () => {
    let calls = 0;
    let release: (value: AdSkipRedemptionReceipt) => void = () => {};
    const { controller } = setup((request) => {
      calls += 1;
      return new Promise((resolve) => {
        release = () => resolve(receiptFor(request));
      });
    });
    const tapA = controller.redeem({ opportunityKey: "cycle:5", placement: "custom" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const tapB = controller.redeem({ opportunityKey: "cycle:5", placement: "custom" });
    expect(controller.isBlocked("custom", "cycle:5")).toBe(true);
    release(receiptFor({ opportunityKey: "cycle:5", placement: "custom", requestId: "request-000000001" }));
    const [a, b] = await Promise.all([tapA, tapB]);
    expect(calls).toBe(1);
    expect(a).toEqual(b);
  });

  test("a receipt's effect applies once across retries and restarts", async () => {
    const storage = mapStorage();
    const { controller } = setup(async (request) => receiptFor(request), storage);
    const outcome = await controller.redeem({ opportunityKey: "cycle:6", placement: "generation_continue" });
    if (outcome.status !== "resolved") throw new Error("expected receipt");
    let applied = 0;
    expect(await controller.applyEffectOnce(outcome.receipt, () => { applied += 1; })).toBe(true);
    expect(await controller.applyEffectOnce({ ...outcome.receipt, replayed: true }, () => { applied += 1; })).toBe(false);
    const restarted = setup(async (request) => receiptFor(request), storage);
    expect(await restarted.controller.applyEffectOnce(outcome.receipt, () => { applied += 1; })).toBe(false);
    expect(applied).toBe(1);
  });
});

test("choice state follows balance, placement and pending results", () => {
  const choice = (overrides: Partial<Parameters<typeof resolveAdSkipChoice>[0]>) =>
    resolveAdSkipChoice({ allowedPlacements: ALLOWED, balance: 2, placement: "custom", ...overrides });
  expect(choice({})).toEqual({ adEnabled: true, balance: 2, reason: null, showTicket: true, ticketEnabled: true });
  expect(choice({ placement: "attendance_restore" })).toMatchObject({ adEnabled: true, reason: "not_allowed", showTicket: false, ticketEnabled: false });
  expect(choice({ balance: null })).toMatchObject({ reason: "loading", ticketEnabled: false, adEnabled: true });
  expect(choice({ balance: 0 })).toMatchObject({ reason: "empty", showTicket: true, ticketEnabled: false, adEnabled: true });
  expect(choice({ blocked: true })).toMatchObject({ reason: "checking", ticketEnabled: false, adEnabled: false });
  expect(choice({ busy: true })).toMatchObject({ reason: "busy", ticketEnabled: false, adEnabled: false });
});
