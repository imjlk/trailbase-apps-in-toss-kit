const STATE_VERSION = 1;
const DEFAULT_STORAGE_KEY = "review-request/v1";

/**
 * Copy this controller into a consumer app and inject the app's own review
 * adapter, storage, eligibility rule, clock, and screen state. The controller
 * records an attempt before calling the SDK and never records whether a review
 * was shown or written.
 */
export function createReviewRequestController({
  review,
  storage,
  isEligible = () => true,
  getScreenState = () => ({ foreground: true, blockingOverlay: false, contextKey: undefined }),
  now = () => Date.now(),
  cooldownMs = 0,
  enabled = true,
  storageKey = DEFAULT_STORAGE_KEY,
  report = () => {},
} = {}) {
  if (!review || typeof review.isSupported !== "function" || typeof review.request !== "function") {
    throw new TypeError("review adapter must implement isSupported() and request()");
  }
  if (!storage || typeof storage.get !== "function" || typeof storage.set !== "function") {
    throw new TypeError("review storage must implement get() and set()");
  }
  if (!Number.isSafeInteger(cooldownMs) || cooldownMs < 0) {
    throw new TypeError("cooldownMs must be a non-negative safe integer");
  }

  let sessionAttempted = false;
  let inFlight = false;

  return {
    async maybeRequest() {
      if (inFlight) return skip("in_flight");
      inFlight = true;
      try {
        if (!enabled) return skip("disabled");
        if (sessionAttempted) return skip("session_attempted");

        const eligible = await readEligibility();
        if (!eligible) return skip("ineligible");

        const initialScreen = await readScreenState();
        if (!isUsableScreen(initialScreen)) return skip("screen_blocked");

        const stored = await readStoredState();
        if (stored.status === "error") return skip("storage_unavailable");
        if (stored.lastAttemptAt !== null && elapsed(now(), stored.lastAttemptAt) < cooldownMs) {
          return skip("cooldown");
        }

        let supported;
        try {
          supported = await review.isSupported();
        } catch (error) {
          return failed(error);
        }
        if (supported !== true) return skip("unsupported");

        const currentScreen = await readScreenState();
        if (!isUsableScreen(currentScreen) || !sameContext(initialScreen, currentScreen)) {
          return skip("stale_context");
        }

        const attemptedAt = now();
        try {
          await storage.set(storageKey, { version: STATE_VERSION, lastAttemptAt: attemptedAt });
        } catch (error) {
          safeReport({ type: "review_request_failed", errorCode: errorCode(error), phase: "storage_write" });
          return { status: "failed", reason: "storage_unavailable" };
        }

        sessionAttempted = true;
        safeReport({ type: "review_request_attempted" });
        try {
          await review.request();
          safeReport({ type: "review_request_settled" });
          return { status: "settled" };
        } catch (error) {
          const result = { status: "failed", reason: errorCode(error) };
          safeReport({ type: "review_request_failed", errorCode: result.reason, phase: "sdk_request" });
          return result;
        }
      } catch (error) {
        const result = { status: "failed", reason: errorCode(error) };
        safeReport({ type: "review_request_failed", errorCode: result.reason, phase: "controller" });
        return result;
      } finally {
        inFlight = false;
      }
    },
  };

  async function readEligibility() {
    try {
      return (await isEligible()) === true;
    } catch (error) {
      safeReport({ type: "review_request_failed", errorCode: errorCode(error), phase: "eligibility" });
      return false;
    }
  }

  async function readScreenState() {
    try {
      const state = await getScreenState();
      return state && typeof state === "object" ? state : { foreground: false, blockingOverlay: true };
    } catch (error) {
      safeReport({ type: "review_request_failed", errorCode: errorCode(error), phase: "screen_state" });
      return { foreground: false, blockingOverlay: true };
    }
  }

  async function readStoredState() {
    try {
      const value = await storage.get(storageKey);
      if (value === null || value === undefined) return { status: "ok", lastAttemptAt: null };
      if (!value || value.version !== STATE_VERSION || !Number.isSafeInteger(value.lastAttemptAt) || value.lastAttemptAt < 0) {
        return { status: "error" };
      }
      return { status: "ok", lastAttemptAt: value.lastAttemptAt };
    } catch (error) {
      safeReport({ type: "review_request_failed", errorCode: errorCode(error), phase: "storage_read" });
      return { status: "error" };
    }
  }

  function skip(reason) {
    const result = { status: "skipped", reason };
    safeReport({ type: "review_request_skipped", reason });
    return result;
  }

  function failed(error) {
    const reason = errorCode(error);
    safeReport({ type: "review_request_failed", errorCode: reason, phase: "support_check" });
    return { status: "failed", reason };
  }

  function safeReport(event) {
    try {
      report(event);
    } catch {
      // Observability must never turn an optional review request into a core-flow failure.
    }
  }
}

function isUsableScreen(state) {
  return state.foreground !== false && state.blockingOverlay !== true;
}

function sameContext(left, right) {
  return Object.is(left.contextKey, right.contextKey);
}

function elapsed(current, previous) {
  return Math.max(0, current - previous);
}

function errorCode(error) {
  return typeof error?.code === "string" && error.code.length > 0 ? error.code : "UNKNOWN_ERROR";
}
