const STATE_VERSION = 1;
const DEFAULT_STORAGE_KEY = "review-request/v1";
const CONTROLLER_REGISTRY = new WeakMap();
const defaultEligibility = () => true;
const defaultScreenState = () => ({ foreground: true, blockingOverlay: false, contextKey: undefined });
const defaultNow = () => Date.now();
const defaultReport = () => {};

/**
 * Copy this controller into a consumer app and inject the app's own review
 * adapter, storage, eligibility rule, clock, and screen state. The controller
 * records an attempt before calling the SDK and never records whether a review
 * was shown or written. Create one controller per storage instance and share
 * it for the app lifecycle; the factory returns that same controller when a
 * screen asks for the same storage/key pair again. `getScreenState()` must
 * return boolean `foreground` and `blockingOverlay` fields plus an optional
 * `contextKey`; malformed state is rejected closed.
 */
export function createReviewRequestController({
  review,
  storage,
  isEligible = defaultEligibility,
  getScreenState = defaultScreenState,
  now = defaultNow,
  cooldownMs = 0,
  enabled = true,
  storageKey = DEFAULT_STORAGE_KEY,
  report = defaultReport,
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
  for (const [name, value] of Object.entries({ isEligible, getScreenState, now, report })) {
    if (typeof value !== "function") throw new TypeError(`${name} must be a function`);
  }
  const existingByKey = CONTROLLER_REGISTRY.get(storage);
  const existing = existingByKey?.get(storageKey);
  const config = { review, isEligible, getScreenState, now, cooldownMs, enabled, report };
  if (existing) {
    if (!sameControllerConfig(existing.config, config)) {
      throw new TypeError("review controller already exists for this storage/key with different options");
    }
    return existing.controller;
  }

  let sessionAttempted = false;
  let inFlight = false;

  const controller = {
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
        if (stored.status === "invalid") {
          try {
            await storage.set(storageKey, { version: STATE_VERSION, lastAttemptAt: now() });
          } catch (error) {
            safeReport({ type: "review_request_failed", errorCode: errorCode(error), phase: "storage_repair" });
          }
          return skip("corrupt_state");
        }
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
  const controllers = existingByKey ?? new Map();
  controllers.set(storageKey, { controller, config });
  CONTROLLER_REGISTRY.set(storage, controllers);
  return controller;

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
      return isValidScreenState(state) ? state : { foreground: false, blockingOverlay: true };
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
        return { status: "invalid" };
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
      const result = report(event);
      if (result && typeof result.then === "function") result.catch(() => {});
    } catch {
      // Observability must never turn an optional review request into a core-flow failure.
    }
  }
}

function isUsableScreen(state) {
  return isValidScreenState(state) && state.foreground && !state.blockingOverlay;
}

function isValidScreenState(state) {
  return (
    state &&
    typeof state === "object" &&
    !Array.isArray(state) &&
    typeof state.foreground === "boolean" &&
    typeof state.blockingOverlay === "boolean"
  );
}

function sameControllerConfig(left, right) {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  return [...keys].every((key) => Object.is(left[key], right[key]));
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
