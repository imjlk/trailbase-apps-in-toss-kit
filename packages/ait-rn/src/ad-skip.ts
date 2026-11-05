import {
  postAppsInTossJson,
  type AppsInTossHeaders,
  type AppsInTossJsonFetcher,
} from "./internal/http";
import {
  createPersistentJsonAtom,
  type PersistentJsonAtomStorage,
} from "./storage";

// App-owned ad skip tickets. The server owns balances, grants, placement allowlists
// and charging; these helpers only keep one request ID per ad opportunity, retry it
// with bounded timeouts, and apply each receipt's local effect at most once.
// A ticket never creates an SDK ad event, impression or reward callback.

export type AdSkipRedemptionResolution = "ALREADY_RESOLVED" | "FREE" | "TICKET";
export type AdOpportunityResolution = "AD" | "FREE" | "TICKET";

export interface AdSkipRedemptionRequest {
  context?: string;
  opportunityKey: string;
  placement: string;
  requestId: string;
}

export interface AdSkipOpportunity {
  opportunityKey: string;
  placement: string;
  reference: string;
  resolution: AdOpportunityResolution;
  resolvedAt: number;
}

export interface AdSkipRedemptionReceipt {
  balance: number;
  consumed: 0 | 1;
  context: string;
  createdAt: number;
  /** How the opportunity was resolved when this receipt did not charge for it. */
  opportunity: AdSkipOpportunity | null;
  opportunityKey: string;
  placement: string;
  receiptId: string;
  replayed: boolean;
  requestId: string;
  resolution: AdSkipRedemptionResolution;
}

export type AdSkipClientErrorCode =
  | "AD_SKIP_INVALID_REQUEST"
  | "AD_SKIP_INVALID_RESPONSE"
  | "AD_SKIP_TIMEOUT";

export class AdSkipClientError extends Error {
  code: AdSkipClientErrorCode;
  override cause?: unknown;

  constructor({
    cause,
    code,
    message,
  }: {
    cause?: unknown;
    code: AdSkipClientErrorCode;
    message: string;
  }) {
    super(message);
    this.name = "AdSkipClientError";
    this.code = code;
    this.cause = cause;
  }
}

const REQUEST_ID = /^[A-Za-z0-9_-]{16,128}$/;
const PLACEMENT = /^[A-Za-z0-9._-]{1,64}$/;
const OPPORTUNITY = /^[A-Za-z0-9._:-]{1,128}$/;

/** A fresh request ID for one ad opportunity. Reuse it for every retry. */
export function createAdSkipRequestId(): string {
  const crypto = (globalThis as { crypto?: Crypto }).crypto;
  if (typeof crypto?.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (typeof crypto?.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

export function normalizeAdSkipRedemptionRequest(
  request: AdSkipRedemptionRequest,
): Required<AdSkipRedemptionRequest> {
  const context = request.context ?? "";
  if (
    typeof request.requestId !== "string" ||
    typeof request.placement !== "string" ||
    typeof request.opportunityKey !== "string" ||
    typeof context !== "string" ||
    !REQUEST_ID.test(request.requestId) ||
    !PLACEMENT.test(request.placement) ||
    !OPPORTUNITY.test(request.opportunityKey) ||
    (context !== "" && !OPPORTUNITY.test(context))
  ) {
    throw new AdSkipClientError({
      code: "AD_SKIP_INVALID_REQUEST",
      message: "Invalid ad skip redemption request.",
    });
  }
  return {
    context,
    opportunityKey: request.opportunityKey,
    placement: request.placement,
    requestId: request.requestId,
  };
}

/**
 * Validates a server receipt. With `expected`, the receipt must belong to that exact
 * request; a mismatch is treated as an invalid response, never as a charge.
 */
export function normalizeAdSkipRedemptionReceipt(
  value: unknown,
  expected?: AdSkipRedemptionRequest,
): AdSkipRedemptionReceipt {
  const record = receiptRecord(value);
  const resolution = record?.resolution;
  const consumed = record?.consumed;
  const receipt =
    record &&
    typeof record.receiptId === "string" &&
    record.receiptId.length > 0 &&
    typeof record.requestId === "string" &&
    typeof record.placement === "string" &&
    typeof record.opportunityKey === "string" &&
    typeof record.context === "string" &&
    (resolution === "TICKET" ||
      resolution === "FREE" ||
      resolution === "ALREADY_RESOLVED") &&
    (consumed === 0 || consumed === 1) &&
    (consumed === 1) === (resolution === "TICKET") &&
    isCount(record.balance) &&
    typeof record.replayed === "boolean" &&
    isCount(record.createdAt)
      ? {
          balance: record.balance as number,
          consumed: consumed as 0 | 1,
          context: record.context,
          createdAt: record.createdAt as number,
          opportunity: normalizeOpportunity(record.opportunity),
          opportunityKey: record.opportunityKey,
          placement: record.placement,
          receiptId: record.receiptId,
          replayed: record.replayed,
          requestId: record.requestId,
          resolution: resolution as AdSkipRedemptionResolution,
        }
      : null;
  if (
    !receipt ||
    receipt.opportunity === undefined ||
    (receipt.resolution === "ALREADY_RESOLVED") !==
      (receipt.opportunity !== null) ||
    (expected &&
      (receipt.requestId !== expected.requestId ||
        receipt.placement !== expected.placement ||
        receipt.opportunityKey !== expected.opportunityKey ||
        receipt.context !== (expected.context ?? "")))
  ) {
    throw new AdSkipClientError({
      code: "AD_SKIP_INVALID_RESPONSE",
      message: "Invalid ad skip redemption response.",
    });
  }
  return receipt as AdSkipRedemptionReceipt;
}

/**
 * Identifies the local effect a receipt unlocks. A different request that finds the
 * same opportunity already resolved maps to the original resolution, so the effect
 * (for example drawing the next ad interval) is applied once per opportunity.
 */
export function adSkipEffectKey(receipt: AdSkipRedemptionReceipt): string {
  if (receipt.opportunity) {
    return `${receipt.opportunity.resolution.toLowerCase()}:${receipt.opportunity.reference}`;
  }
  return `${receipt.resolution.toLowerCase()}:${receipt.receiptId}`;
}

export interface CreateAdSkipRedemptionClientOptions {
  baseUrl?: string;
  fetcher?: AppsInTossJsonFetcher;
  getAuthHeaders?: () => AppsInTossHeaders | Promise<AppsInTossHeaders>;
  redeemEndpoint: string;
}

export interface AdSkipRedemptionClient {
  redeem(request: AdSkipRedemptionRequest): Promise<AdSkipRedemptionReceipt>;
}

export function createAdSkipRedemptionClient({
  baseUrl,
  fetcher,
  getAuthHeaders,
  redeemEndpoint,
}: CreateAdSkipRedemptionClientOptions): AdSkipRedemptionClient {
  return {
    async redeem(request) {
      const body = normalizeAdSkipRedemptionRequest(request);
      const payload = await postAppsInTossJson({
        baseUrl,
        body,
        fetcher,
        getAuthHeaders,
        path: redeemEndpoint,
      });
      return normalizeAdSkipRedemptionReceipt(payload, body);
    },
  };
}

export interface AdSkipPendingRedemption {
  context: string;
  createdAt: number;
  opportunityKey: string;
  placement: string;
  requestId: string;
}

export type AdSkipRedeemOutcome =
  | { receipt: AdSkipRedemptionReceipt; status: "resolved" }
  /** The server answered definitively; nothing was charged for this request. */
  | { code: string | null; error: unknown; status: "rejected" }
  /** The result is still unknown. The request ID is kept for a later check. */
  | { error: unknown; pending: AdSkipPendingRedemption; status: "unknown" };

export interface AdSkipControllerSnapshot {
  /** Server balance, or null while it is unknown. */
  balance: number | null;
  /** Opportunities with a redemption request currently on the wire. */
  inFlight: readonly string[];
  /** Requests whose result is not known yet. They survive app restarts. */
  pending: readonly AdSkipPendingRedemption[];
  ready: boolean;
}

export interface CreateAdSkipRedemptionControllerOptions {
  createRequestId?: () => string;
  isRetryable?: (error: unknown) => boolean;
  maxAppliedEffects?: number;
  maxAttempts?: number;
  maxPending?: number;
  now?: () => number;
  redeem: (request: AdSkipRedemptionRequest) => Promise<AdSkipRedemptionReceipt>;
  retryDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  storage: PersistentJsonAtomStorage;
  storageKey: string;
  timeoutMs?: number;
}

export interface AdSkipRedemptionController {
  /**
   * Runs `effect` only the first time this receipt's effect key is seen. The key is
   * persisted before the effect runs, so a crash can skip but never repeat it.
   */
  applyEffectOnce(
    receipt: AdSkipRedemptionReceipt,
    effect: () => void | Promise<void>,
  ): Promise<boolean>;
  /**
   * Forget an unknown request only after the opportunity is known to be settled
   * another way. Never use it to retry the same choice with a new request ID.
   */
  discardPending(placement: string, opportunityKey: string): Promise<void>;
  getSnapshot(): AdSkipControllerSnapshot;
  isBlocked(placement: string, opportunityKey: string): boolean;
  load(): Promise<void>;
  /**
   * Redeem a ticket for one opportunity. A pending request for the same opportunity
   * is retried with its original request ID and context; a concurrent call joins the
   * request already on the wire.
   */
  redeem(input: {
    context?: string;
    opportunityKey: string;
    placement: string;
  }): Promise<AdSkipRedeemOutcome>;
  /** Re-check pending requests with their original IDs, e.g. after an app restart. */
  retryPending(): Promise<AdSkipRedeemOutcome[]>;
  setBalance(balance: number | null): void;
  subscribe(listener: () => void): () => void;
}

interface PersistedAdSkipState {
  applied: string[];
  pending: AdSkipPendingRedemption[];
  version: 1;
}

export function createAdSkipRedemptionController({
  createRequestId = createAdSkipRequestId,
  isRetryable = isRetryableAdSkipError,
  maxAppliedEffects = 100,
  maxAttempts = 3,
  maxPending = 20,
  now = Date.now,
  redeem,
  retryDelayMs = 600,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  storage,
  storageKey,
  timeoutMs = 10_000,
}: CreateAdSkipRedemptionControllerOptions): AdSkipRedemptionController {
  const attempts = Math.max(1, Math.floor(maxAttempts));
  const atom = createPersistentJsonAtom<PersistedAdSkipState>({
    fallback: () => ({ applied: [], pending: [], version: 1 }),
    key: storageKey,
    normalize: normalizePersistedState,
    storage,
  });
  let state: PersistedAdSkipState = { applied: [], pending: [], version: 1 };
  let snapshot: AdSkipControllerSnapshot = {
    balance: null,
    inFlight: [],
    pending: [],
    ready: false,
  };
  let loading: Promise<void> | null = null;
  let writes = Promise.resolve();
  const inFlight = new Map<string, Promise<AdSkipRedeemOutcome>>();
  const listeners = new Set<() => void>();

  function publish(next: Partial<AdSkipControllerSnapshot> = {}) {
    snapshot = {
      ...snapshot,
      ...next,
      inFlight: [...inFlight.keys()],
      pending: state.pending,
    };
    for (const listener of listeners) {
      listener();
    }
  }
  function persist() {
    const value = state;
    writes = writes.then(() => atom.write(value)).catch(() => {});
    return writes;
  }
  function find(key: string) {
    return state.pending.find(
      (entry) => opportunityId(entry.placement, entry.opportunityKey) === key,
    );
  }
  async function removePending(key: string) {
    state = {
      ...state,
      pending: state.pending.filter(
        (entry) => opportunityId(entry.placement, entry.opportunityKey) !== key,
      ),
    };
    await persist();
  }

  async function settle(
    key: string,
    request: AdSkipPendingRedemption,
  ): Promise<AdSkipRedeemOutcome> {
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const receipt = normalizeAdSkipRedemptionReceipt(
          // Persisted recovery metadata is not part of the server request contract.
          await withTimeout(redeem(normalizeAdSkipRedemptionRequest(request)), timeoutMs),
          request,
        );
        await removePending(key);
        publish({ balance: receipt.balance });
        return { receipt, status: "resolved" };
      } catch (error) {
        lastError = error;
        if (!isRetryable(error)) {
          const code = adSkipErrorCode(error);
          await removePending(key);
          publish(
            code === "AD_SKIP_INSUFFICIENT_BALANCE" ? { balance: 0 } : {},
          );
          return { code, error, status: "rejected" };
        }
        if (attempt < attempts) {
          await sleep(retryDelayMs * attempt);
        }
      }
    }
    publish();
    return { error: lastError, pending: request, status: "unknown" };
  }

  function run(key: string, request: AdSkipPendingRedemption) {
    const existing = inFlight.get(key);
    if (existing) {
      return existing;
    }
    const promise = settle(key, request).finally(() => {
      inFlight.delete(key);
      publish();
    });
    inFlight.set(key, promise);
    publish();
    return promise;
  }

  const controller: AdSkipRedemptionController = {
    async applyEffectOnce(receipt, effect) {
      await controller.load();
      const key = adSkipEffectKey(receipt);
      if (state.applied.includes(key)) {
        return false;
      }
      state = {
        ...state,
        applied: [...state.applied, key].slice(-Math.max(1, maxAppliedEffects)),
      };
      await persist();
      await effect();
      return true;
    },
    async discardPending(placement, opportunityKey) {
      await controller.load();
      await removePending(opportunityId(placement, opportunityKey));
      publish();
    },
    getSnapshot: () => snapshot,
    isBlocked(placement, opportunityKey) {
      const key = opportunityId(placement, opportunityKey);
      return inFlight.has(key) || find(key) !== undefined;
    },
    load() {
      loading ??= atom.read().then((value) => {
        state = value;
        publish({ ready: true });
      });
      return loading;
    },
    async redeem({ context = "", opportunityKey, placement }) {
      await controller.load();
      const key = opportunityId(placement, opportunityKey);
      const running = inFlight.get(key);
      if (running) {
        return running;
      }
      let request = find(key);
      if (!request) {
        try {
          request = {
            ...normalizeAdSkipRedemptionRequest({
              context,
              opportunityKey,
              placement,
              requestId: createRequestId(),
            }),
            createdAt: now(),
          };
        } catch (error) {
          return { code: adSkipErrorCode(error), error, status: "rejected" };
        }
        // Persist before sending so a lost response is recovered with the same ID.
        state = {
          ...state,
          pending: [...state.pending, request].slice(-Math.max(1, maxPending)),
        };
        await persist();
      }
      return run(key, request);
    },
    async retryPending() {
      await controller.load();
      return Promise.all(
        state.pending.map((entry) =>
          run(opportunityId(entry.placement, entry.opportunityKey), entry),
        ),
      );
    },
    setBalance(balance) {
      publish({ balance: isCount(balance) ? balance : null });
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  return controller;
}

/**
 * Network failures, timeouts, an expired session (401), 408/425/429 and 5xx keep the
 * request pending: the server may already have committed it.
 */
export function isRetryableAdSkipError(error: unknown): boolean {
  if (error instanceof AdSkipClientError) {
    return error.code !== "AD_SKIP_INVALID_REQUEST";
  }
  const status = (error as { status?: unknown } | null)?.status;
  if (typeof status !== "number") {
    return true;
  }
  return (
    status === 401 ||
    status === 408 ||
    status === 425 ||
    status === 429 ||
    status >= 500
  );
}

export function adSkipErrorCode(error: unknown): string | null {
  if (error instanceof AdSkipClientError) {
    return error.code;
  }
  const payload = (error as { payload?: unknown } | null)?.payload;
  const nested =
    payload && typeof payload === "object"
      ? (payload as { error?: unknown }).error
      : undefined;
  const code =
    nested && typeof nested === "object"
      ? (nested as { code?: unknown }).code
      : (payload as { code?: unknown } | undefined)?.code;
  return typeof code === "string" && code ? code : null;
}

export type AdSkipChoiceReason =
  | "busy"
  | "checking"
  | "empty"
  | "loading"
  | "not_allowed";

export interface AdSkipChoice {
  adEnabled: boolean;
  balance: number | null;
  reason: AdSkipChoiceReason | null;
  showTicket: boolean;
  ticketEnabled: boolean;
}

/**
 * Button state for an ad prompt. Placements outside `allowedPlacements` (such as an
 * attendance restore) never show a ticket choice. A pending result blocks both the
 * ticket and a new ad for the same opportunity until it is known.
 */
export function resolveAdSkipChoice({
  allowedPlacements,
  balance,
  blocked = false,
  busy = false,
  placement,
}: {
  allowedPlacements: readonly string[];
  balance: number | null;
  /** True while a redemption result for this opportunity is still unknown. */
  blocked?: boolean;
  /** True while an ad or ticket for this opportunity is running. */
  busy?: boolean;
  placement: string;
}): AdSkipChoice {
  const knownBalance = isCount(balance) ? balance : null;
  if (!allowedPlacements.includes(placement)) {
    return {
      adEnabled: !busy && !blocked,
      balance: knownBalance,
      reason: "not_allowed",
      showTicket: false,
      ticketEnabled: false,
    };
  }
  const reason: AdSkipChoiceReason | null = busy
    ? "busy"
    : blocked
      ? "checking"
      : knownBalance === null
        ? "loading"
        : knownBalance < 1
          ? "empty"
          : null;
  return {
    adEnabled: !busy && !blocked,
    balance: knownBalance,
    reason,
    showTicket: true,
    ticketEnabled: reason === null,
  };
}

function opportunityId(placement: string, opportunityKey: string) {
  return `${placement}\u0000${opportunityKey}`;
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function receiptRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  for (const nested of [record.redemption, record.data]) {
    if (nested && typeof nested === "object" && "receiptId" in nested) {
      return nested as Record<string, unknown>;
    }
  }
  return record;
}

function normalizeOpportunity(value: unknown): AdSkipOpportunity | null | undefined {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "object") {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  return typeof record.placement === "string" &&
    typeof record.opportunityKey === "string" &&
    typeof record.reference === "string" &&
    record.reference.length > 0 &&
    (record.resolution === "AD" ||
      record.resolution === "FREE" ||
      record.resolution === "TICKET") &&
    isCount(record.resolvedAt)
    ? {
        opportunityKey: record.opportunityKey,
        placement: record.placement,
        reference: record.reference,
        resolution: record.resolution,
        resolvedAt: record.resolvedAt,
      }
    : undefined;
}

function normalizePersistedState(value: unknown): PersistedAdSkipState | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (
    record.version !== 1 ||
    !Array.isArray(record.applied) ||
    !Array.isArray(record.pending)
  ) {
    return null;
  }
  const pending: AdSkipPendingRedemption[] = [];
  for (const entry of record.pending) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const candidate = entry as Record<string, unknown>;
    try {
      const request = normalizeAdSkipRedemptionRequest(
        candidate as unknown as AdSkipRedemptionRequest,
      );
      if (isCount(candidate.createdAt)) {
        pending.push({ ...request, createdAt: candidate.createdAt });
      }
    } catch {
      // Drop malformed local rows; the server receipt remains the source of truth.
    }
  }
  return {
    applied: record.applied.filter(
      (key): key is string => typeof key === "string" && key.length > 0,
    ),
    pending,
    version: 1,
  };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(
        () =>
          reject(
            new AdSkipClientError({
              code: "AD_SKIP_TIMEOUT",
              message: "Ad skip redemption timed out.",
            }),
          ),
        timeoutMs,
      );
    }),
  ]).finally(() => clearTimeout(timer));
}
