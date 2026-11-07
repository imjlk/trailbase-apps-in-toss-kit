// Shared by the RN and WebView IAP bridges and the platform-neutral grant client.
// Not public API: consumers import these through ait-rn/iap or ait-web/iap.
export type AppsInTossIapBridgeErrorCode =
  | "IAP_SUBSCRIPTION_UNAVAILABLE"
  | "IAP_SUBSCRIPTION_UNSUPPORTED"
  | "IAP_SUBSCRIPTION_QUERY_FAILED"
  | "IAP_SUBSCRIPTION_QUERY_TIMEOUT"
  | "IAP_SUBSCRIPTION_INVALID_RESPONSE"
  | "IAP_COMPLETE_PRODUCT_GRANT_FAILED"
  | "IAP_COMPLETE_PRODUCT_GRANT_REJECTED"
  | "IAP_COMPLETE_PRODUCT_GRANT_UNAVAILABLE"
  | "IAP_COMPLETE_PRODUCT_GRANT_UNSUPPORTED"
  | "IAP_GET_PENDING_ORDERS_FAILED"
  | "IAP_GET_PENDING_ORDERS_UNAVAILABLE"
  | "IAP_GET_PENDING_ORDERS_UNSUPPORTED"
  | "IAP_GET_PRODUCTS_FAILED"
  | "IAP_GET_PRODUCTS_UNAVAILABLE"
  | "IAP_GET_PRODUCTS_UNSUPPORTED"
  | "IAP_ORDER_ID_REQUIRED"
  | "IAP_PRODUCT_GRANT_FAILED"
  | "IAP_PRODUCT_GRANT_REQUIRED"
  | "IAP_PRODUCT_GRANT_TIMEOUT"
  | "IAP_PURCHASE_FAILED"
  | "IAP_PURCHASE_INVALID_EVENT"
  | "IAP_PURCHASE_TIMEOUT"
  | "IAP_PURCHASE_UNAVAILABLE"
  | "IAP_PURCHASE_UNSUPPORTED"
  | "IAP_SDK_UNAVAILABLE"
  | "IAP_SDK_UNSUPPORTED"
  | "IAP_SKU_REQUIRED";

export interface AppsInTossIapBridgeErrorOptions {
  cause?: unknown;
  code: AppsInTossIapBridgeErrorCode;
  message: string;
}

export class AppsInTossIapBridgeError extends Error {
  code: AppsInTossIapBridgeErrorCode;
  override cause?: unknown;

  constructor({ cause, code, message }: AppsInTossIapBridgeErrorOptions) {
    super(message);
    this.name = "AppsInTossIapBridgeError";
    this.code = code;
    this.cause = cause;
  }
}

/** @internal */
export function normalizeRequiredOrderId(value?: string | null) {
  const normalized = normalizeOptionalString(value);
  if (!normalized) {
    throw new AppsInTossIapBridgeError({
      code: "IAP_ORDER_ID_REQUIRED",
      message: "Apps in Toss IAP orderId is required.",
    });
  }
  return normalized;
}

/** @internal */
export function normalizeRequiredSku(value?: string | null) {
  const normalized = normalizeOptionalString(value);
  if (!normalized) {
    throw new AppsInTossIapBridgeError({
      code: "IAP_SKU_REQUIRED",
      message: "Apps in Toss IAP sku is required.",
    });
  }
  return normalized;
}

/** @internal */
export function normalizeOptionalString(value?: unknown) {
  const trimmed = typeof value === "string" ? value.trim() : undefined;
  return trimmed ? trimmed : undefined;
}

export interface AppsInTossIapPendingOrder {
  orderId: string;
  paymentCompletedDate?: string;
  sku: string;
}

export interface AppsInTossIapProductGrantInput {
  subscriptionId?: string;
  orderId: string;
  providerPayload?: unknown;
  sku: string;
  source: "purchase" | "restore";
}

export type AppsInTossIapProductGrantOutcome =
  | boolean
  | {
      alreadyGranted?: boolean;
      granted?: boolean;
      ok?: boolean;
      status?: string;
    };

export type AppsInTossIapProcessProductGrant = (
  input: AppsInTossIapProductGrantInput,
) =>
  AppsInTossIapProductGrantOutcome | Promise<AppsInTossIapProductGrantOutcome>;

export interface AppsInTossIapRestorePendingOrdersOptions {
  completeAfterGrant?: boolean;
  onProductGrantCompleted?: (
    input: AppsInTossIapProductGrantInput,
  ) => void | Promise<void>;
  processProductGrant: AppsInTossIapProcessProductGrant;
  processProductGrantTimeoutMs?: number;
  stopOnError?: boolean;
}

export interface AppsInTossIapRestoredOrderResult {
  completed: boolean;
  completionDeferred?: boolean;
  error?: unknown;
  granted: boolean;
  hookError?: unknown;
  order: AppsInTossIapPendingOrder;
}

export interface AppsInTossIapRestorePendingOrdersResult {
  failed: AppsInTossIapRestoredOrderResult[];
  orders: AppsInTossIapPendingOrder[];
  restored: AppsInTossIapRestoredOrderResult[];
  results: AppsInTossIapRestoredOrderResult[];
}

/** @internal Runtime-specific SDK access for the shared restore loop. */
export interface AppsInTossIapPendingOrderSource {
  /** Resolves true only when the SDK acknowledged the grant; throws otherwise. */
  completeProductGrant(orderId: string): Promise<boolean>;
  getPendingOrders(): Promise<AppsInTossIapPendingOrder[]>;
  processProductGrantTimeoutMs: number;
}

/**
 * @internal Restores pending orders one at a time. The SDK grant acknowledgement
 * runs only after the backend grant succeeded for that order, so a failed or
 * timed-out grant leaves the order pending for the next restore.
 */
export async function restoreIapPendingOrders(
  {
    completeAfterGrant = true,
    onProductGrantCompleted,
    processProductGrant,
    processProductGrantTimeoutMs,
    stopOnError = false,
  }: AppsInTossIapRestorePendingOrdersOptions,
  source: AppsInTossIapPendingOrderSource,
): Promise<AppsInTossIapRestorePendingOrdersResult> {
  if (typeof processProductGrant !== "function") {
    throw new AppsInTossIapBridgeError({
      code: "IAP_PRODUCT_GRANT_REQUIRED",
      message: "Apps in Toss IAP product grant processor is required.",
    });
  }
  const grantTimeoutMs = processProductGrantTimeoutMs ?? source.processProductGrantTimeoutMs;
  const orders = await source.getPendingOrders();
  const results: AppsInTossIapRestoredOrderResult[] = [];

  for (const order of orders) {
    let granted = false;
    try {
      granted = await runProductGrant({
        orderId: order.orderId,
        processProductGrant,
        providerPayload: order,
        sku: order.sku,
        source: "restore",
        timeoutMs: grantTimeoutMs,
      });
      let completed = false;
      const completionDeferred = granted && !completeAfterGrant;
      if (granted && completeAfterGrant) {
        completed = await source.completeProductGrant(order.orderId);
      }
      let hookError: unknown;
      if (granted && completed) {
        try {
          await onProductGrantCompleted?.({
            orderId: order.orderId,
            providerPayload: order,
            sku: order.sku,
            source: "restore",
          });
        } catch (error) {
          hookError = error;
        }
      }
      results.push({
        completed,
        ...(completionDeferred ? { completionDeferred } : {}),
        granted,
        ...(hookError === undefined ? {} : { hookError }),
        order,
      });
    } catch (error) {
      results.push({ completed: false, error, granted, order });
      if (stopOnError) {
        throw error;
      }
    }
  }

  return {
    failed: results.filter((result) => !restoreResultSucceeded(result)),
    orders,
    restored: results.filter(restoreResultSucceeded),
    results,
  };
}

/** @internal Runs the consumer's backend grant under a deadline. */
export async function runProductGrant({
  orderId,
  processProductGrant,
  providerPayload,
  subscriptionId,
  sku,
  source,
  timeoutMs,
}: AppsInTossIapProductGrantInput & {
  processProductGrant: AppsInTossIapProcessProductGrant;
  timeoutMs: number;
}) {
  const normalizedOrderId = normalizeRequiredOrderId(orderId);
  const normalizedSku = normalizeRequiredSku(sku);
  try {
    const outcome = await withIapTimeout({
      code: "IAP_PRODUCT_GRANT_TIMEOUT",
      message: "Apps in Toss product grant timed out.",
      promise: Promise.resolve(
        processProductGrant({
          orderId: normalizedOrderId,
          providerPayload,
          ...(subscriptionId ? { subscriptionId } : {}),
          sku: normalizedSku,
          source,
        }),
      ),
      timeoutMs,
    });
    if (productGrantSucceeded(outcome)) {
      return true;
    }
    throw new AppsInTossIapBridgeError({
      cause: outcome,
      code: "IAP_PRODUCT_GRANT_FAILED",
      message: "Apps in Toss product grant was not completed.",
    });
  } catch (error) {
    if (error instanceof AppsInTossIapBridgeError) {
      throw error;
    }
    throw new AppsInTossIapBridgeError({
      cause: error,
      code: "IAP_PRODUCT_GRANT_FAILED",
      message: "Apps in Toss product grant failed.",
    });
  }
}

/** @internal */
export async function withIapTimeout<T>({
  code,
  message,
  promise,
  timeoutMs,
}: {
  code: AppsInTossIapBridgeErrorCode;
  message: string;
  promise: Promise<T>;
  timeoutMs: number;
}) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          reject(new AppsInTossIapBridgeError({ code, message }));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

/** @internal */
export function normalizePendingOrder(value: unknown): AppsInTossIapPendingOrder {
  const record = objectRecord(value);
  const sku = stringCandidate(record.sku);
  const paymentCompletedDate = stringCandidate(
    record.paymentCompletedDate,
    record.payment_completed_date,
  );
  return {
    orderId: normalizeRequiredOrderId(
      stringCandidate(record.orderId, record.order_id),
    ),
    ...(paymentCompletedDate ? { paymentCompletedDate } : {}),
    sku: sku ? normalizeRequiredSku(sku) : "",
  };
}

function productGrantSucceeded(outcome: AppsInTossIapProductGrantOutcome) {
  if (outcome === true) {
    return true;
  }
  if (!outcome || typeof outcome !== "object") {
    return false;
  }
  if (outcome.granted === true || outcome.alreadyGranted === true) {
    return true;
  }
  if (outcome.granted === false || outcome.alreadyGranted === false) {
    return false;
  }
  const status = outcome.status?.trim().toUpperCase();
  if (
    status === "GRANTED" ||
    status === "ALREADY_GRANTED" ||
    status === "PURCHASED" ||
    status === "COMPLETED"
  ) {
    return true;
  }
  return outcome.ok === true && !status;
}

function restoreResultSucceeded(result: AppsInTossIapRestoredOrderResult) {
  return (
    result.granted && (result.completed || result.completionDeferred === true)
  );
}

function objectRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringCandidate(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
    if (typeof value === "number" || typeof value === "boolean") {
      return String(value);
    }
  }
  return undefined;
}
