import assert from "node:assert/strict";
import test from "node:test";
import { createReviewRequestController } from "./review-request-controller.mjs";

function setup(options = {}) {
  let stored = null;
  const events = [];
  const screen = { foreground: true, blockingOverlay: false, contextKey: "account-a" };
  const clock = options.clock ?? (() => options.now ?? 1_000);
  const eligibility = options.isEligible ?? (() => true);
  const screenState = () => screen;
  const reporter = options.report ?? ((event) => events.push(event));
  const calls = { request: 0 };
  const review = {
    async isSupported() {
      return options.supported ?? true;
    },
    async request() {
      calls.request += 1;
      if (options.request) return options.request();
    },
  };
  const storage = {
    async get() {
      if (options.readError) throw options.readError;
      return stored;
    },
    async set(_key, value) {
      if (options.writeError) throw options.writeError;
      stored = value;
    },
  };
  const controller = createReviewRequestController({
    review,
    storage,
    now: clock,
    cooldownMs: options.cooldownMs ?? 0,
    isEligible: eligibility,
    getScreenState: screenState,
    report: reporter,
  });
  return {
    controller,
    review,
    clock,
    eligibility,
    screenState,
    reporter,
    calls,
    events,
    storage,
    get stored() {
      return stored;
    },
  };
}

test("records the attempt before the SDK request and preserves only call-settled semantics", async () => {
  const state = setup({
    request: async () => {
      assert.equal(state.stored.lastAttemptAt, 1_000);
    },
  });
  const result = await state.controller.maybeRequest();
  assert.deepEqual(result, { status: "settled" });
  assert.equal(state.calls.request, 1);
  assert.deepEqual(state.events, [
    { type: "review_request_attempted" },
    { type: "review_request_settled" },
  ]);
});

test("coalesces neither duplicate controller calls nor session retries into another SDK request", async () => {
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  const state = setup({ request: () => pending });
  const first = state.controller.maybeRequest();
  const second = await state.controller.maybeRequest();
  assert.deepEqual(second, { status: "skipped", reason: "in_flight" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(state.calls.request, 1);
  release();
  assert.deepEqual(await first, { status: "settled" });
  assert.deepEqual(await state.controller.maybeRequest(), { status: "skipped", reason: "session_attempted" });
  assert.equal(state.calls.request, 1);
});

test("skips safely when storage fails, support is unavailable, or the screen context changes", async () => {
  const storageFailure = setup({ readError: new Error("private storage failure") });
  assert.deepEqual(await storageFailure.controller.maybeRequest(), { status: "skipped", reason: "storage_unavailable" });
  assert.equal(storageFailure.calls.request, 0);

  const unsupported = setup({ supported: false });
  assert.deepEqual(await unsupported.controller.maybeRequest(), { status: "skipped", reason: "unsupported" });
  assert.equal(unsupported.calls.request, 0);

  const stale = setup();
  let screenReads = 0;
  stale.controller = createReviewRequestController({
    review: {
      isSupported: async () => true,
      request: async () => {
        throw new Error("must not request stale context");
      },
    },
    storage: {
      get: async () => null,
      set: async () => {},
    },
    getScreenState: () => {
      screenReads += 1;
      return { foreground: true, blockingOverlay: false, contextKey: screenReads === 1 ? "account-a" : "account-b" };
    },
  });
  assert.deepEqual(await stale.controller.maybeRequest(), { status: "skipped", reason: "stale_context" });
});

test("reuses one controller for the same storage/key and fails closed on invalid screen or state", async () => {
  const shared = setup();
  const sameController = createReviewRequestController({
    review: shared.review,
    storage: shared.storage,
    now: shared.clock,
    isEligible: shared.eligibility,
    getScreenState: shared.screenState,
    report: shared.reporter,
  });
  assert.equal(sameController, shared.controller);

  const malformedScreen = createReviewRequestController({
    review: { isSupported: async () => true, request: async () => {} },
    storage: { get: async () => null, set: async () => {} },
    getScreenState: async () => ({}),
  });
  assert.deepEqual(await malformedScreen.maybeRequest(), { status: "skipped", reason: "screen_blocked" });

  const invalidState = createReviewRequestController({
    review: { isSupported: async () => true, request: async () => {} },
    storage: { get: async () => ({ version: 99, lastAttemptAt: 1 }), set: async () => {} },
  });
  assert.deepEqual(await invalidState.maybeRequest(), { status: "skipped", reason: "corrupt_state" });
});

test("does not call the SDK when writing the attempt or eligibility fails", async () => {
  const writeFailure = setup({ writeError: new Error("write failed") });
  assert.deepEqual(await writeFailure.controller.maybeRequest(), { status: "failed", reason: "storage_unavailable" });
  assert.equal(writeFailure.calls.request, 0);

  const ineligible = setup({ isEligible: async () => false });
  assert.deepEqual(await ineligible.controller.maybeRequest(), { status: "skipped", reason: "ineligible" });
  assert.equal(ineligible.calls.request, 0);
});

test("keeps the cooldown and attempt record across a new controller instance", async () => {
  const first = setup({ cooldownMs: 10_000 });
  assert.deepEqual(await first.controller.maybeRequest(), { status: "settled" });
  const persisted = first.stored;
  const second = setup({ cooldownMs: 10_000, now: 5_000 });
  // Simulate the same persisted record without exposing a review-written flag.
  second.controller = createReviewRequestController({
    review: {
      isSupported: async () => true,
      request: async () => {
        throw new Error("must not request during cooldown");
      },
    },
    storage: {
      get: async () => persisted,
      set: async () => {},
    },
    now: () => 5_000,
    cooldownMs: 10_000,
  });
  assert.deepEqual(await second.controller.maybeRequest(), { status: "skipped", reason: "cooldown" });
});

test("a never-settling SDK call does not block the caller's core completion", async () => {
  let requestStarted = false;
  const state = setup({
    request: () => {
      requestStarted = true;
      return new Promise(() => {});
    },
  });
  const reviewPromise = state.controller.maybeRequest();
  let coreCompleted = false;
  queueMicrotask(() => {
    coreCompleted = true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(coreCompleted, true);
  void reviewPromise;
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(requestStarted, true);
});

test("does not expose raw SDK errors and keeps a failed attempt from immediate retry", async () => {
  const state = setup({
    request: async () => {
      throw Object.assign(new Error("raw private payload"), { code: "UNSUPPORTED_APP_VERSION" });
    },
  });
  assert.deepEqual(await state.controller.maybeRequest(), { status: "failed", reason: "UNSUPPORTED_APP_VERSION" });
  assert.equal(JSON.stringify(state.events).includes("raw private payload"), false);
  assert.deepEqual(await state.controller.maybeRequest(), { status: "skipped", reason: "session_attempted" });
});

test("swallows async telemetry failures while keeping the optional request usable", async () => {
  const state = setup({ report: async () => { throw new Error("analytics unavailable"); } });
  assert.deepEqual(await state.controller.maybeRequest(), { status: "settled" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(state.stored.lastAttemptAt, 1_000);
});
