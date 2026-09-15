import { createReactNativeIap } from "@ait-kit/sdk/rn";
import type {
  IapPurchaseResult,
  IapGrantCallback,
} from "@ait-kit/sdk";
import {
  createCleanupOnce,
  isAppsInTossBridgeSupported,
  withBridgeTimeout,
} from "./internal/event-bridge";
import { isSdkError } from "./internal/sdk-errors";
import {
  postAppsInTossJson,
  type AppsInTossHeaders,
  type AppsInTossJsonFetcher,
} from "./internal/http";

// Structural contracts remain loadable with older peer SDKs. CI checks these
// against the actual pinned SDK; new methods remain optional at runtime.
export type AppsInTossIapProductType =
  "CONSUMABLE" | "NON_CONSUMABLE" | "SUBSCRIPTION";
export type AppsInTossIapRenewalCycle = "WEEKLY" | "MONTHLY" | "YEARLY";
export type AppsInTossIapOffer =
  | { type: "FREE_TRIAL"; offerId: string; period: string }
  | {
      type: "NEW_SUBSCRIPTION" | "RETURNING";
      offerId: string;
      period: string;
      displayAmount: string;
    };
export type AppsInTossIapSubscriptionProduct = AppsInTossIapProduct & {
  type: "SUBSCRIPTION";
  renewalCycle: AppsInTossIapRenewalCycle;
};
export interface AppsInTossIapSubscriptionInfo {
  catalogId: number;
  status:
    "ACTIVE" | "EXPIRED" | "IN_GRACE_PERIOD" | "ON_HOLD" | "PAUSED" | "REVOKED";
  expiresAt: string | null;
  isAutoRenew: boolean;
  gracePeriodExpiresAt: string | null;
  isAccessible: boolean;
}

export interface AppsInTossIapProduct {
  type?: AppsInTossIapProductType;
  renewalCycle?: AppsInTossIapRenewalCycle;
  offers?: AppsInTossIapOffer[];
  description: string;
  displayAmount: string;
  displayName: string;
  iconUrl: string;
  sku: string;
}

export interface AppsInTossIapPendingOrder {
  orderId: string;
  paymentCompletedDate?: string;
  sku: string;
}

export interface AppsInTossIapPurchaseResult {
  subscriptionId?: string;
  amount?: number;
  currency?: string;
  displayAmount?: string;
  displayName?: string;
  fraction?: number;
  miniAppIconUrl?: string | null;
  orderId: string;
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

type AppsInTossIapSupportedFunction<T> = T & {
  isSupported?: () => boolean;
};

export type AppsInTossIapGetProductItemList = AppsInTossIapSupportedFunction<
  () => Promise<{ products?: unknown[] } | undefined>
>;

export type AppsInTossIapCreateOneTimePurchaseOrder =
  AppsInTossIapSupportedFunction<
    (params: {
      onError: (error: unknown) => void | Promise<void>;
      onEvent: (event: unknown) => void | Promise<void>;
      options: {
        processProductGrant: (params: {
          orderId: string;
        }) => boolean | Promise<boolean>;
        sku: string;
      };
    }) => void | (() => void)
  >;

export type AppsInTossIapCreateSubscriptionPurchaseOrder =
  AppsInTossIapSupportedFunction<
    (params: {
      onError: (error: unknown) => void | Promise<void>;
      onEvent: (event: unknown) => void | Promise<void>;
      options: {
        sku: string;
        offerId?: string | null;
        processProductGrant: (params: {
          orderId: string;
          subscriptionId?: string;
        }) => boolean | Promise<boolean>;
      };
    }) => void | (() => void)
  >;
export type AppsInTossIapGetSubscriptionInfo = AppsInTossIapSupportedFunction<
  (params: {
    params: { orderId: string };
  }) => Promise<{ subscription: AppsInTossIapSubscriptionInfo } | undefined>
>;

export type AppsInTossIapGetPendingOrders = AppsInTossIapSupportedFunction<
  () => Promise<{ orders?: unknown[] } | undefined>
>;

export type AppsInTossIapCompleteProductGrant = AppsInTossIapSupportedFunction<
  (params: { params: { orderId: string } }) => Promise<boolean | undefined>
>;

export interface AppsInTossIapSdk {
  createSubscriptionPurchaseOrder?: AppsInTossIapCreateSubscriptionPurchaseOrder;
  getSubscriptionInfo?: AppsInTossIapGetSubscriptionInfo;
  completeProductGrant?: AppsInTossIapCompleteProductGrant;
  createOneTimePurchaseOrder?: AppsInTossIapCreateOneTimePurchaseOrder;
  getPendingOrders?: AppsInTossIapGetPendingOrders;
  getProductItemList?: AppsInTossIapGetProductItemList;
  isSupported?: () => boolean;
}

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

export interface CreateAppsInTossIapBridgeOptions {
  IAP?: AppsInTossIapSdk;
  completeProductGrantTimeoutMs?: number;
  getPendingOrdersTimeoutMs?: number;
  getProductsTimeoutMs?: number;
  getSubscriptionInfoTimeoutMs?: number;
  processProductGrantTimeoutMs?: number;
  purchaseTimeoutMs?: number;
}

export interface AppsInTossIapPurchaseOneTimeOptions {
  processProductGrant: AppsInTossIapProcessProductGrant;
  processProductGrantTimeoutMs?: number;
  sku: string;
}

export interface AppsInTossIapPurchaseSubscriptionOptions extends AppsInTossIapPurchaseOneTimeOptions {
  offerId?: string | null;
}

export interface AppsInTossIapCompleteProductGrantOptions {
  orderId: string;
}

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

export interface AppsInTossIapBridge {
  purchaseSubscription(
    options: AppsInTossIapPurchaseSubscriptionOptions,
  ): Promise<AppsInTossIapPurchaseResult>;
  getSubscriptionInfo(options: {
    orderId: string;
  }): Promise<AppsInTossIapSubscriptionInfo>;
  completeProductGrant(
    options: AppsInTossIapCompleteProductGrantOptions,
  ): Promise<boolean>;
  getProducts(): Promise<AppsInTossIapProduct[]>;
  purchaseOneTime(
    options: AppsInTossIapPurchaseOneTimeOptions,
  ): Promise<AppsInTossIapPurchaseResult>;
  restorePendingOrders(
    options: AppsInTossIapRestorePendingOrdersOptions,
  ): Promise<AppsInTossIapRestorePendingOrdersResult>;
}

export function createAppsInTossIapBridge({
  IAP,
  completeProductGrantTimeoutMs = 15_000,
  getPendingOrdersTimeoutMs = 15_000,
  getProductsTimeoutMs = 15_000,
  getSubscriptionInfoTimeoutMs = 15_000,
  processProductGrantTimeoutMs = 25_000,
  purchaseTimeoutMs,
}: CreateAppsInTossIapBridgeOptions = {}): AppsInTossIapBridge {
  async function getIap() {
    const resolvedIap = IAP ?? (await defaultIapSdk());
    assertIapAvailable(resolvedIap);
    return resolvedIap;
  }

  async function getProducts() {
    const iap = await getIap();
    const getProductItemList = iap.getProductItemList;
    if (!getProductItemList) {
      throw new AppsInTossIapBridgeError({
        code: "IAP_GET_PRODUCTS_UNAVAILABLE",
        message: "Apps in Toss IAP.getProductItemList is not available.",
      });
    }
    assertSupported(getProductItemList, {
      code: "IAP_GET_PRODUCTS_UNSUPPORTED",
      message: "Apps in Toss product list is not supported in this runtime.",
    });

    try {
      const response = await withPromiseTimeout({
        code: "IAP_GET_PRODUCTS_UNSUPPORTED",
        message: "Apps in Toss product list is not supported in this runtime.",
        promise: getProductItemList(),
        timeoutMs: getProductsTimeoutMs,
      });
      if (!response) {
        throw new AppsInTossIapBridgeError({
          code: "IAP_GET_PRODUCTS_UNSUPPORTED",
          message:
            "Apps in Toss product list is not supported in this runtime.",
        });
      }
      return (response.products ?? []).map(normalizeProduct);
    } catch (error) {
      if (error instanceof AppsInTossIapBridgeError) {
        throw error;
      }
      throw new AppsInTossIapBridgeError({
        cause: error,
        code: "IAP_GET_PRODUCTS_FAILED",
        message: "Apps in Toss product list request failed.",
      });
    }
  }

  async function purchaseOneTime({
    processProductGrant,
    processProductGrantTimeoutMs: grantTimeoutMs = processProductGrantTimeoutMs,
    sku,
  }: AppsInTossIapPurchaseOneTimeOptions) {
    const normalizedSku = normalizeRequiredSku(sku);
    if (typeof processProductGrant !== "function") {
      throw new AppsInTossIapBridgeError({
        code: "IAP_PRODUCT_GRANT_REQUIRED",
        message: "Apps in Toss IAP product grant processor is required.",
      });
    }
    if (!IAP) {
      return purchaseViaAitKitSdk({
        grantTimeoutMs,
        kind: "one-time",
        processProductGrant,
        sku: normalizedSku,
      });
    }

    const iap = await getIap();
    const createOneTimePurchaseOrder = iap.createOneTimePurchaseOrder;
    if (!createOneTimePurchaseOrder) {
      throw new AppsInTossIapBridgeError({
        code: "IAP_PURCHASE_UNAVAILABLE",
        message:
          "Apps in Toss IAP.createOneTimePurchaseOrder is not available.",
      });
    }
    assertSupported(createOneTimePurchaseOrder, {
      code: "IAP_PURCHASE_UNSUPPORTED",
      message:
        "Apps in Toss one-time purchase is not supported in this runtime.",
    });

    return requestPurchase({
      createPurchaseOrder: createOneTimePurchaseOrder,
      processProductGrant,
      processProductGrantTimeoutMs: grantTimeoutMs,
      purchaseTimeoutMs,
      sku: normalizedSku,
    });
  }

  async function purchaseSubscription({
    sku,
    offerId,
    processProductGrant,
    processProductGrantTimeoutMs: grantTimeoutMs = processProductGrantTimeoutMs,
  }: AppsInTossIapPurchaseSubscriptionOptions) {
    const normalizedSku = normalizeRequiredSku(sku);
    if (typeof processProductGrant !== "function")
      throw new AppsInTossIapBridgeError({
        code: "IAP_PRODUCT_GRANT_REQUIRED",
        message: "Apps in Toss IAP product grant processor is required.",
      });
    if (!IAP) {
      return purchaseViaAitKitSdk({
        grantTimeoutMs,
        kind: "subscription",
        offerId: normalizeOptionalString(offerId),
        processProductGrant,
        sku: normalizedSku,
      });
    }

    const iap = await getIap();
    const createPurchaseOrder = iap.createSubscriptionPurchaseOrder;
    if (!createPurchaseOrder)
      throw new AppsInTossIapBridgeError({
        code: "IAP_SUBSCRIPTION_UNAVAILABLE",
        message: "Apps in Toss subscription purchase is unavailable.",
      });
    assertSupported(createPurchaseOrder, {
      code: "IAP_SUBSCRIPTION_UNSUPPORTED",
      message: "Subscription purchase is unsupported in this runtime.",
    });
    return requestPurchase({
      createPurchaseOrder,
      processProductGrant,
      purchaseKind: "subscription",
      processProductGrantTimeoutMs: grantTimeoutMs,
      purchaseTimeoutMs,
      sku: normalizedSku,
      offerId: normalizeOptionalString(offerId),
    });
  }

  async function getSubscriptionInfo({ orderId }: { orderId: string }) {
    const normalizedOrderId = normalizeRequiredOrderId(orderId);
    const iap = await getIap();
    const getInfo = iap.getSubscriptionInfo;
    if (!getInfo)
      throw new AppsInTossIapBridgeError({
        code: "IAP_SUBSCRIPTION_UNAVAILABLE",
        message: "Subscription status query is unavailable.",
      });
    assertSupported(getInfo, {
      code: "IAP_SUBSCRIPTION_UNSUPPORTED",
      message: "Subscription status query is unsupported in this runtime.",
    });
    try {
      const response = await withPromiseTimeout({
        code: "IAP_SUBSCRIPTION_QUERY_TIMEOUT",
        message: "Subscription status query timed out.",
        promise: getInfo({ params: { orderId: normalizedOrderId } }),
        timeoutMs: getSubscriptionInfoTimeoutMs,
      });
      if (response === undefined)
        throw new AppsInTossIapBridgeError({
          code: "IAP_SUBSCRIPTION_UNSUPPORTED",
          message: "Subscription status query is unsupported in this runtime.",
        });
      const info = response.subscription;
      if (
        !info ||
        ![
          "ACTIVE",
          "EXPIRED",
          "IN_GRACE_PERIOD",
          "ON_HOLD",
          "PAUSED",
          "REVOKED",
        ].includes(info.status) ||
        !Number.isFinite(info.catalogId) ||
        typeof info.isAccessible !== "boolean" ||
        typeof info.isAutoRenew !== "boolean" ||
        !(info.expiresAt === null || typeof info.expiresAt === "string") ||
        !(
          info.gracePeriodExpiresAt === null ||
          typeof info.gracePeriodExpiresAt === "string"
        )
      ) {
        throw new AppsInTossIapBridgeError({
          code: "IAP_SUBSCRIPTION_INVALID_RESPONSE",
          message: "Subscription status response is invalid.",
        });
      }
      return {
        catalogId: info.catalogId,
        status: info.status,
        expiresAt: info.expiresAt,
        isAutoRenew: info.isAutoRenew,
        gracePeriodExpiresAt: info.gracePeriodExpiresAt,
        isAccessible: info.isAccessible,
      };
    } catch (cause) {
      if (cause instanceof AppsInTossIapBridgeError) throw cause;
      throw new AppsInTossIapBridgeError({
        code: "IAP_SUBSCRIPTION_QUERY_FAILED",
        message: "Subscription status query failed.",
        cause,
      });
    }
  }

  async function completeProductGrant({
    orderId,
  }: AppsInTossIapCompleteProductGrantOptions) {
    const normalizedOrderId = normalizeRequiredOrderId(orderId);
    const iap = await getIap();
    const completeProductGrant = iap.completeProductGrant;
    if (!completeProductGrant) {
      throw new AppsInTossIapBridgeError({
        code: "IAP_COMPLETE_PRODUCT_GRANT_UNAVAILABLE",
        message: "Apps in Toss IAP.completeProductGrant is not available.",
      });
    }
    assertSupported(completeProductGrant, {
      code: "IAP_COMPLETE_PRODUCT_GRANT_UNSUPPORTED",
      message:
        "Apps in Toss product grant completion is not supported in this runtime.",
    });

    try {
      const result = await withPromiseTimeout({
        code: "IAP_COMPLETE_PRODUCT_GRANT_UNSUPPORTED",
        message:
          "Apps in Toss product grant completion is not supported in this runtime.",
        promise: completeProductGrant({
          params: { orderId: normalizedOrderId },
        }),
        timeoutMs: completeProductGrantTimeoutMs,
      });
      if (result === undefined) {
        throw new AppsInTossIapBridgeError({
          code: "IAP_COMPLETE_PRODUCT_GRANT_UNSUPPORTED",
          message:
            "Apps in Toss product grant completion is not supported in this runtime.",
        });
      }
      if (result !== true) {
        throw new AppsInTossIapBridgeError({
          code: "IAP_COMPLETE_PRODUCT_GRANT_REJECTED",
          message: "Apps in Toss product grant completion was rejected.",
        });
      }
      return true;
    } catch (error) {
      if (error instanceof AppsInTossIapBridgeError) {
        throw error;
      }
      throw new AppsInTossIapBridgeError({
        cause: error,
        code: "IAP_COMPLETE_PRODUCT_GRANT_FAILED",
        message: "Apps in Toss product grant completion failed.",
      });
    }
  }

  async function restorePendingOrders({
    completeAfterGrant = true,
    onProductGrantCompleted,
    processProductGrant,
    processProductGrantTimeoutMs: grantTimeoutMs = processProductGrantTimeoutMs,
    stopOnError = false,
  }: AppsInTossIapRestorePendingOrdersOptions) {
    if (typeof processProductGrant !== "function") {
      throw new AppsInTossIapBridgeError({
        code: "IAP_PRODUCT_GRANT_REQUIRED",
        message: "Apps in Toss IAP product grant processor is required.",
      });
    }
    const orders = await getPendingOrders();
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
          completed = await completeProductGrant({ orderId: order.orderId });
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
        const result = {
          completed: false,
          error,
          granted,
          order,
        };
        results.push(result);
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

  async function getPendingOrders() {
    if (!IAP) {
      return pendingOrdersViaAitKitSdk();
    }
    const iap = await getIap();
    const getPendingOrders = iap.getPendingOrders;
    if (!getPendingOrders) {
      throw new AppsInTossIapBridgeError({
        code: "IAP_GET_PENDING_ORDERS_UNAVAILABLE",
        message: "Apps in Toss IAP.getPendingOrders is not available.",
      });
    }
    assertSupported(getPendingOrders, {
      code: "IAP_GET_PENDING_ORDERS_UNSUPPORTED",
      message: "Apps in Toss pending order restore is not supported.",
    });
    try {
      const response = await withPromiseTimeout({
        code: "IAP_GET_PENDING_ORDERS_UNSUPPORTED",
        message: "Apps in Toss pending order restore is not supported.",
        promise: getPendingOrders(),
        timeoutMs: getPendingOrdersTimeoutMs,
      });
      if (!response) {
        throw new AppsInTossIapBridgeError({
          code: "IAP_GET_PENDING_ORDERS_UNSUPPORTED",
          message: "Apps in Toss pending order restore is not supported.",
        });
      }
      return (response.orders ?? []).map(normalizePendingOrder);
    } catch (error) {
      if (error instanceof AppsInTossIapBridgeError) {
        throw error;
      }
      throw new AppsInTossIapBridgeError({
        cause: error,
        code: "IAP_GET_PENDING_ORDERS_FAILED",
        message: "Apps in Toss pending order restore failed.",
      });
    }
  }

  return {
    completeProductGrant,
    getProducts,
    purchaseOneTime,
    purchaseSubscription,
    getSubscriptionInfo,
    restorePendingOrders,
  };

  /**
   * Default-path purchase flow delegated to @ait-kit/sdk's IAP adapter
   * (module acquisition, event settle-once, order/grant matching, single
   * deadline, cleanup). The TrailBase grant policy stays here: the
   * consumer callback runs under TrailBase's grant timeout with the
   * provider payload and source bookkeeping. An injected `IAP` module
   * keeps the local synchronous flow instead — injection seams carry
   * their own semantics and preserve the synchronous registration
   * contract.
   */
  async function purchaseViaAitKitSdk({
    grantTimeoutMs,
    kind,
    offerId,
    processProductGrant,
    sku,
  }: {
    grantTimeoutMs: number;
    kind: "one-time" | "subscription";
    offerId?: string;
    processProductGrant: AppsInTossIapProcessProductGrant;
    sku: string;
  }): Promise<AppsInTossIapPurchaseResult> {
    const grant: IapGrantCallback = async (target) => {
      const granted = await runProductGrant({
        orderId: target.orderId,
        processProductGrant,
        providerPayload: {
          orderId: target.orderId,
          ...(target.subscriptionId ? { subscriptionId: target.subscriptionId } : {}),
        },
        ...(target.subscriptionId ? { subscriptionId: target.subscriptionId } : {}),
        sku: target.sku,
        source: "purchase",
        timeoutMs: grantTimeoutMs,
      });
      if (!granted) {
        throw new Error("grant rejected");
      }
    };
    const adapter = createReactNativeIap({
      grant,
      // TrailBase installs no hard checkout deadline unless configured.
      purchaseTimeoutMs: purchaseTimeoutMs && purchaseTimeoutMs > 0 ? purchaseTimeoutMs : 0,
    });
    let result: IapPurchaseResult;
    try {
      result =
        kind === "subscription"
          ? await adapter.purchaseSubscription(sku, offerId)
          : await adapter.purchaseOneTime(sku);
    } catch (error) {
      throw purchaseSdkError(error, kind);
    }
    return mapAitKitPurchaseResult(result, kind, sku);
  }

  async function pendingOrdersViaAitKitSdk(): Promise<
    AppsInTossIapPendingOrder[]
  > {
    let orders: { orders: import("@ait-kit/sdk").IapPendingOrder[] };
    try {
      orders = await withPromiseTimeout({
        code: "IAP_GET_PENDING_ORDERS_UNSUPPORTED",
        message: "Apps in Toss pending order restore is not supported.",
        promise: createReactNativeIap({
          grant: async () => {
            throw new Error("grant must not run for pending-order listing");
          },
        }).getPendingOrders(),
        timeoutMs: getPendingOrdersTimeoutMs,
      });
    } catch (error) {
      if (isSdkError(error)) {
        throw new AppsInTossIapBridgeError({
          cause: error,
          code:
            error.code === "SDK_UNAVAILABLE"
              ? "IAP_GET_PENDING_ORDERS_UNAVAILABLE"
              : "IAP_GET_PENDING_ORDERS_UNSUPPORTED",
          message: "Apps in Toss pending order restore is not supported.",
        });
      }
      throw new AppsInTossIapBridgeError({
        cause: error,
        code: "IAP_GET_PENDING_ORDERS_FAILED",
        message: "Apps in Toss pending order restore failed.",
      });
    }
    return orders.orders.map((order) =>
      normalizePendingOrder({
        orderId: order.orderId,
        paymentCompletedDate: order.paymentCompletedDate,
        sku: order.sku,
      }),
    );
  }
}

function purchaseSdkError(error: unknown, kind: "one-time" | "subscription") {
  if (isSdkError(error)) {
    if (error.code === "SDK_UNAVAILABLE") {
      // Module-load failures keep the shared IAP_SDK_UNAVAILABLE code the
      // local path used, so consumers can distinguish a missing SDK
      // installation from an unavailable purchase method.
      return new AppsInTossIapBridgeError({
        cause: error,
        code: "IAP_SDK_UNAVAILABLE",
        message: "Apps in Toss IAP module is not available.",
      });
    }
    if (error.code === "UNSUPPORTED") {
      return new AppsInTossIapBridgeError({
        cause: error,
        code: "IAP_PURCHASE_UNSUPPORTED",
        message: `Apps in Toss ${kind} purchase is not supported in this runtime.`,
      });
    }
  }
  return new AppsInTossIapBridgeError({
    cause: error,
    code: "IAP_PURCHASE_FAILED",
    message: `Apps in Toss ${kind} purchase failed.`,
  });
}

/**
 * Maps @ait-kit/sdk purchase outcomes onto the TrailBase error taxonomy.
 * Grant outcomes lose the timeout/failed distinction (the sdk reports
 * grant_failed with a reason string); that merge is documented in the
 * migration notes — the restore flow keeps the precise codes.
 */
function mapAitKitPurchaseResult(
  result: IapPurchaseResult,
  kind: "one-time" | "subscription",
  requestSku: string,
): AppsInTossIapPurchaseResult {
  switch (result.status) {
    case "completed":
      return {
        ...(Number.isFinite(result.success.amount)
          ? { amount: result.success.amount }
          : {}),
        ...(result.success.currency ? { currency: result.success.currency } : {}),
        ...(result.success.displayAmount
          ? { displayAmount: result.success.displayAmount }
          : {}),
        ...(result.success.displayName
          ? { displayName: result.success.displayName }
          : {}),
        ...(Number.isFinite(result.success.fraction)
          ? { fraction: result.success.fraction }
          : {}),
        ...(result.success.miniAppIconUrl !== undefined
          ? { miniAppIconUrl: result.success.miniAppIconUrl }
          : {}),
        orderId: normalizeRequiredOrderId(result.orderId),
        sku: normalizeRequiredSku(requestSku),
        ...(result.subscriptionId !== undefined
          ? { subscriptionId: result.subscriptionId }
          : {}),
      };
    case "grant_failed":
      throw new AppsInTossIapBridgeError({
        cause: result.reason,
        code: "IAP_PRODUCT_GRANT_FAILED",
        message: "Apps in Toss product grant was not completed.",
      });
    case "unknown":
      throw new AppsInTossIapBridgeError({
        cause: result.reason,
        code: "IAP_PURCHASE_TIMEOUT",
        message: `Apps in Toss ${kind} purchase timed out.`,
      });
    default:
      // canceled and failed both surface as IAP_PURCHASE_FAILED, matching
      // the local flow, which treats every provider rejection identically.
      throw new AppsInTossIapBridgeError({
        cause:
          result.status === "failed"
            ? { code: result.code, reason: result.reason }
            : result,
        code: "IAP_PURCHASE_FAILED",
        message: `Apps in Toss ${kind} purchase failed.`,
      });
  }
}

export type AppsInTossIapGrantOperation = "complete" | "grant" | "pending";

export interface AppsInTossIapGrantClientEndpoints {
  completeEndpoint: string;
  grantEndpoint: string;
  pendingEndpoint: string;
}

export interface CreateAppsInTossIapGrantClientOptions<TResult = unknown> {
  baseUrl?: string;
  endpoints: AppsInTossIapGrantClientEndpoints;
  fetcher?: AppsInTossJsonFetcher;
  getAuthHeaders?: () => AppsInTossHeaders | Promise<AppsInTossHeaders>;
  normalizeResponse?: (
    value: unknown,
    context: { operation: AppsInTossIapGrantOperation },
  ) => TResult;
}

export interface AppsInTossIapGrantInput {
  orderId: string;
  providerPayload?: unknown;
  requestId?: string | null;
  sku: string;
  source?: string;
}

export interface AppsInTossIapCompleteInput {
  orderId: string;
  providerPayload?: unknown;
  sku?: string | null;
}

export interface AppsInTossIapPendingInput {
  orders?: AppsInTossIapPendingOrder[];
  providerPayload?: unknown;
}

export interface AppsInTossIapGrantClient<TResult = unknown> {
  complete(input: AppsInTossIapCompleteInput): Promise<TResult>;
  grant(input: AppsInTossIapGrantInput): Promise<TResult>;
  pending(input?: AppsInTossIapPendingInput): Promise<TResult>;
}

export function createAppsInTossIapGrantClient<TResult = unknown>({
  baseUrl,
  endpoints,
  fetcher,
  getAuthHeaders,
  normalizeResponse,
}: CreateAppsInTossIapGrantClientOptions<TResult>): AppsInTossIapGrantClient<TResult> {
  async function post(
    operation: AppsInTossIapGrantOperation,
    path: string,
    body: unknown,
  ) {
    const payload = await postAppsInTossJson({
      baseUrl,
      body,
      fetcher,
      getAuthHeaders,
      path,
    });
    return normalizeResponse
      ? normalizeResponse(payload, { operation })
      : (payload as TResult);
  }

  return {
    complete({ orderId, providerPayload, sku }) {
      return post("complete", endpoints.completeEndpoint, {
        orderId: normalizeRequiredOrderId(orderId),
        ...(providerPayload === undefined ? {} : { providerPayload }),
        ...(normalizeOptionalString(sku)
          ? { sku: normalizeOptionalString(sku) }
          : {}),
      });
    },
    grant({ orderId, providerPayload, requestId, sku, source }) {
      return post("grant", endpoints.grantEndpoint, {
        orderId: normalizeRequiredOrderId(orderId),
        ...(providerPayload === undefined ? {} : { providerPayload }),
        ...(normalizeOptionalString(requestId)
          ? { requestId: normalizeOptionalString(requestId) }
          : {}),
        sku: normalizeRequiredSku(sku),
        ...(normalizeOptionalString(source)
          ? { source: normalizeOptionalString(source) }
          : {}),
      });
    },
    pending(input = {}) {
      return post("pending", endpoints.pendingEndpoint, {
        ...(input.orders ? { orders: input.orders } : {}),
        ...(input.providerPayload === undefined
          ? {}
          : { providerPayload: input.providerPayload }),
      });
    },
  };
}

function requestPurchase({
  purchaseKind = "one-time",
  createPurchaseOrder,
  offerId,
  processProductGrant,
  processProductGrantTimeoutMs,
  purchaseTimeoutMs,
  sku,
}: {
  purchaseKind?: "one-time" | "subscription";
  createPurchaseOrder: AppsInTossIapCreateSubscriptionPurchaseOrder;
  offerId?: string;
  processProductGrant: AppsInTossIapProcessProductGrant;
  processProductGrantTimeoutMs: number;
  purchaseTimeoutMs?: number;
  sku: string;
}) {
  return new Promise<AppsInTossIapPurchaseResult>((resolve, reject) => {
    let cleanup = createCleanupOnce();
    let productGrantCompleted = false;
    let purchaseResult: AppsInTossIapPurchaseResult | undefined;
    let grantedSubscriptionId: string | undefined;
    let settled = false;
    const clearPurchaseTimeout =
      purchaseTimeoutMs && purchaseTimeoutMs > 0
        ? withBridgeTimeout({
            onTimeout: () => {
              settleReject(
                new AppsInTossIapBridgeError({
                  code: "IAP_PURCHASE_TIMEOUT",
                  message: `Apps in Toss ${purchaseKind} purchase timed out.`,
                }),
              );
            },
            timeoutMs: purchaseTimeoutMs,
          })
        : () => undefined;

    try {
      const nextCleanup = createPurchaseOrder({
        onError: (error) => {
          settleReject(
            new AppsInTossIapBridgeError({
              cause: error,
              code: "IAP_PURCHASE_FAILED",
              message: `Apps in Toss ${purchaseKind} purchase failed.`,
            }),
          );
        },
        onEvent: (event) => {
          const eventType = normalizeEventType(event);
          if (eventType !== "success") {
            settleReject(
              new AppsInTossIapBridgeError({
                cause: event,
                code: "IAP_PURCHASE_INVALID_EVENT",
                message: `Apps in Toss ${purchaseKind} purchase event was invalid.`,
              }),
            );
            return;
          }
          try {
            purchaseResult = normalizePurchaseResult(event, sku);
            resolvePurchaseIfReady();
          } catch (error) {
            settleReject(error);
          }
        },
        options: {
          ...(offerId ? { offerId } : {}),
          processProductGrant: async ({ orderId, subscriptionId }) => {
            if (settled) return false;
            try {
              const granted = await runProductGrant({
                orderId: normalizeRequiredOrderId(orderId),
                processProductGrant,
                providerPayload: {
                  orderId,
                  ...(subscriptionId ? { subscriptionId } : {}),
                },
                ...(subscriptionId ? { subscriptionId } : {}),
                sku,
                source: "purchase",
                timeoutMs: processProductGrantTimeoutMs,
              });
              productGrantCompleted = granted;
              grantedSubscriptionId = subscriptionId;
              resolvePurchaseIfReady();
              return granted;
            } catch (error) {
              settleReject(error);
              return false;
            }
          },
          sku,
        },
      });
      cleanup = createCleanupOnce(nextCleanup);
      if (settled) {
        cleanupBestEffort();
      }
    } catch (error) {
      settleReject(
        new AppsInTossIapBridgeError({
          cause: error,
          code: "IAP_PURCHASE_FAILED",
          message: `Apps in Toss ${purchaseKind} purchase failed.`,
        }),
      );
    }

    function resolvePurchaseIfReady() {
      if (purchaseResult && productGrantCompleted) {
        settleResolve({
          ...purchaseResult,
          ...(grantedSubscriptionId
            ? { subscriptionId: grantedSubscriptionId }
            : {}),
        });
      }
    }

    function settleResolve(result: AppsInTossIapPurchaseResult) {
      if (settled) {
        return;
      }
      settled = true;
      clearPurchaseTimeout();
      resolve(result);
      cleanupBestEffort();
    }

    function settleReject(error: unknown) {
      if (settled) {
        return;
      }
      settled = true;
      clearPurchaseTimeout();
      reject(error);
      cleanupBestEffort();
    }

    function cleanupBestEffort() {
      try {
        cleanup();
      } catch {
        // SDK cleanup should never keep the purchase promise unsettled.
      }
    }
  });
}

async function runProductGrant({
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
    const outcome = await withPromiseTimeout({
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

async function withPromiseTimeout<T>({
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

function normalizeProduct(value: unknown): AppsInTossIapProduct {
  const record = objectRecord(value);
  const type = ["CONSUMABLE", "NON_CONSUMABLE", "SUBSCRIPTION"].includes(
    String(record.type),
  )
    ? (record.type as AppsInTossIapProductType)
    : undefined;
  const subscription =
    type === "SUBSCRIPTION" ? normalizeSubscriptionProduct(record) : {};
  return {
    ...(type ? { type } : {}),
    ...subscription,
    description: stringCandidate(record.description) ?? "",
    displayAmount:
      stringCandidate(record.displayAmount, record.display_amount) ?? "",
    displayName: stringCandidate(record.displayName, record.display_name) ?? "",
    iconUrl: stringCandidate(record.iconUrl, record.icon_url) ?? "",
    sku: normalizeRequiredSku(stringCandidate(record.sku)),
  };
}

function normalizeSubscriptionProduct(record: Record<string, unknown>) {
  if (!["WEEKLY", "MONTHLY", "YEARLY"].includes(String(record.renewalCycle))) {
    throw new AppsInTossIapBridgeError({
      code: "IAP_SUBSCRIPTION_INVALID_RESPONSE",
      message: "Subscription renewal cycle is invalid.",
    });
  }
  const offers = Array.isArray(record.offers)
    ? (record.offers.map((value) => {
        const offer = objectRecord(value);
        const offerId = stringCandidate(offer.offerId);
        const period = stringCandidate(offer.period);
        const displayAmount = stringCandidate(offer.displayAmount);
        if (
          !["FREE_TRIAL", "NEW_SUBSCRIPTION", "RETURNING"].includes(
            String(offer.type),
          ) ||
          !offerId ||
          !period ||
          (offer.type !== "FREE_TRIAL" && !displayAmount)
        ) {
          throw new AppsInTossIapBridgeError({
            code: "IAP_SUBSCRIPTION_INVALID_RESPONSE",
            message: "Subscription offer is invalid.",
          });
        }
        return {
          type: offer.type,
          offerId,
          period,
          ...(offer.type !== "FREE_TRIAL"
            ? { displayAmount }
            : {}),
        };
      }) as AppsInTossIapSubscriptionProduct["offers"])
    : undefined;
  return {
    renewalCycle:
      record.renewalCycle as AppsInTossIapSubscriptionProduct["renewalCycle"],
    ...(offers ? { offers } : {}),
  };
}

function normalizePendingOrder(value: unknown): AppsInTossIapPendingOrder {
  const record = objectRecord(value);
  const sku = stringCandidate(record.sku);
  return {
    orderId: normalizeRequiredOrderId(
      stringCandidate(record.orderId, record.order_id),
    ),
    ...(stringCandidate(
      record.paymentCompletedDate,
      record.payment_completed_date,
    )
      ? {
          paymentCompletedDate: stringCandidate(
            record.paymentCompletedDate,
            record.payment_completed_date,
          ),
        }
      : {}),
    sku: sku ? normalizeRequiredSku(sku) : "",
  };
}

function normalizePurchaseResult(
  event: unknown,
  fallbackSku: string,
): AppsInTossIapPurchaseResult {
  const record = objectRecord(event);
  const data = objectRecord(record.data ?? event);
  return {
    ...(numberCandidate(data.amount) === undefined
      ? {}
      : { amount: numberCandidate(data.amount) }),
    ...(stringCandidate(data.currency)
      ? { currency: stringCandidate(data.currency) }
      : {}),
    ...(stringCandidate(data.displayAmount, data.display_amount)
      ? {
          displayAmount: stringCandidate(
            data.displayAmount,
            data.display_amount,
          ),
        }
      : {}),
    ...(stringCandidate(data.displayName, data.display_name)
      ? { displayName: stringCandidate(data.displayName, data.display_name) }
      : {}),
    ...(numberCandidate(data.fraction) === undefined
      ? {}
      : { fraction: numberCandidate(data.fraction) }),
    ...(data.miniAppIconUrl === null || data.mini_app_icon_url === null
      ? { miniAppIconUrl: null }
      : stringCandidate(data.miniAppIconUrl, data.mini_app_icon_url)
        ? {
            miniAppIconUrl: stringCandidate(
              data.miniAppIconUrl,
              data.mini_app_icon_url,
            ),
          }
        : {}),
    orderId: normalizeRequiredOrderId(
      stringCandidate(data.orderId, data.order_id),
    ),
    sku: normalizeRequiredSku(stringCandidate(data.sku) ?? fallbackSku),
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

function assertIapAvailable(
  iap?: AppsInTossIapSdk,
): asserts iap is AppsInTossIapSdk {
  if (!iap) {
    throw new AppsInTossIapBridgeError({
      code: "IAP_SDK_UNAVAILABLE",
      message: "Apps in Toss IAP SDK is not available.",
    });
  }
  assertSupported(iap, {
    code: "IAP_SDK_UNSUPPORTED",
    message: "Apps in Toss IAP SDK is not supported in this runtime.",
  });
}

function assertSupported(
  target: { isSupported?: () => boolean },
  error: { code: AppsInTossIapBridgeErrorCode; message: string },
) {
  if (!isAppsInTossBridgeSupported(target)) {
    throw new AppsInTossIapBridgeError(error);
  }
}

function normalizeRequiredOrderId(value?: string | null) {
  const normalized = normalizeOptionalString(value);
  if (!normalized) {
    throw new AppsInTossIapBridgeError({
      code: "IAP_ORDER_ID_REQUIRED",
      message: "Apps in Toss IAP orderId is required.",
    });
  }
  return normalized;
}

function normalizeRequiredSku(value?: string | null) {
  const normalized = normalizeOptionalString(value);
  if (!normalized) {
    throw new AppsInTossIapBridgeError({
      code: "IAP_SKU_REQUIRED",
      message: "Apps in Toss IAP sku is required.",
    });
  }
  return normalized;
}

function normalizeOptionalString(value?: unknown) {
  const trimmed = typeof value === "string" ? value.trim() : undefined;
  return trimmed ? trimmed : undefined;
}

function normalizeEventType(value: unknown) {
  if (!value || typeof value !== "object") {
    return null;
  }
  return stringCandidate((value as Record<string, unknown>).type);
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

function numberCandidate(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

async function defaultIapSdk() {
  try {
    const framework = (await import("@apps-in-toss/framework")) as {
      IAP?: AppsInTossIapSdk;
    };
    return framework.IAP;
  } catch {
    return undefined;
  }
}
