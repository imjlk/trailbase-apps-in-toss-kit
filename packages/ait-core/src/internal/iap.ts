// Shared by the RN IAP bridge and the platform-neutral grant client. Not public API:
// consumers import AppsInTossIapBridgeError through ait-rn/iap or ait-web/iap.
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
