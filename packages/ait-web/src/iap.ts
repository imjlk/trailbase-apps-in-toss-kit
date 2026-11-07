import { isAppsInTossBridgeSupported } from "@trailbase-apps-in-toss-kit/ait-core/internal/event-bridge";
import {
  AppsInTossIapBridgeError,
  normalizePendingOrder,
  normalizeRequiredOrderId,
  restoreIapPendingOrders,
  withIapTimeout,
  type AppsInTossIapBridgeErrorCode,
  type AppsInTossIapPendingOrder,
  type AppsInTossIapRestorePendingOrdersOptions,
  type AppsInTossIapRestorePendingOrdersResult,
} from "@trailbase-apps-in-toss-kit/ait-core/internal/iap";

// The error class, grant and restore types and the backend grant client are
// shared with RN through ait-core. Purchases go through ait.purchase() and
// ait.subscribe(); this entry adds the pending-order restore flow.
export * from "@trailbase-apps-in-toss-kit/ait-core/iap";

type SupportedFunction<T> = T & { isSupported?: () => boolean };

/** The SDK 3 IAP members the restore bridge reads. */
export interface AppsInTossWebIapRestoreSdk {
  IAP?: {
    completeProductGrant?: SupportedFunction<
      (args: { params: { orderId: string } }) => Promise<boolean | undefined>
    >;
    getPendingOrders?: SupportedFunction<
      () => Promise<{ orders?: unknown[] } | undefined>
    >;
    isSupported?: () => boolean;
  };
}

export interface CreateAppsInTossIapRestoreBridgeOptions {
  completeProductGrantTimeoutMs?: number;
  getPendingOrdersTimeoutMs?: number;
  /** Resolve from the consumer's SDK dependency; never acquires the RN SDK. */
  loadSdk?: () => Promise<AppsInTossWebIapRestoreSdk>;
  processProductGrantTimeoutMs?: number;
}

export interface AppsInTossIapRestoreBridge {
  /**
   * Acknowledges one order to the SDK. Call it only after the backend persisted
   * the grant; it resolves true only when the SDK returned literal true.
   */
  completeProductGrant(options: { orderId: string }): Promise<boolean>;
  getPendingOrders(): Promise<AppsInTossIapPendingOrder[]>;
  /** Same options, results and error codes as the RN bridge's restorePendingOrders. */
  restorePendingOrders(
    options: AppsInTossIapRestorePendingOrdersOptions,
  ): Promise<AppsInTossIapRestorePendingOrdersResult>;
}

/**
 * WebView pending-order restore: list SDK 3 pending orders, run the backend
 * grant for each, and acknowledge an order only after its grant succeeded.
 */
export function createAppsInTossIapRestoreBridge({
  completeProductGrantTimeoutMs = 15_000,
  getPendingOrdersTimeoutMs = 15_000,
  loadSdk = () => import("@apps-in-toss/web-framework"),
  processProductGrantTimeoutMs = 25_000,
}: CreateAppsInTossIapRestoreBridgeOptions = {}): AppsInTossIapRestoreBridge {
  async function getIap() {
    let sdk: AppsInTossWebIapRestoreSdk | undefined;
    try {
      sdk = await loadSdk();
    } catch {
      // Loader details stay out of the error; they can name private paths.
      sdk = undefined;
    }
    const iap = sdk?.IAP;
    if (!iap) {
      throw bridgeError("IAP_SDK_UNAVAILABLE", "Apps in Toss IAP SDK is not available.");
    }
    assertSupported(iap, "IAP_SDK_UNSUPPORTED", "Apps in Toss IAP SDK is not supported in this runtime.");
    return iap;
  }

  async function getPendingOrders() {
    const read = (await getIap()).getPendingOrders;
    if (!read) {
      throw bridgeError("IAP_GET_PENDING_ORDERS_UNAVAILABLE", "Apps in Toss IAP.getPendingOrders is not available.");
    }
    const unsupported = "Apps in Toss pending order restore is not supported.";
    assertSupported(read, "IAP_GET_PENDING_ORDERS_UNSUPPORTED", unsupported);
    try {
      const response = await withIapTimeout({
        code: "IAP_GET_PENDING_ORDERS_UNSUPPORTED",
        message: unsupported,
        promise: read(),
        timeoutMs: getPendingOrdersTimeoutMs,
      });
      if (!response) {
        throw bridgeError("IAP_GET_PENDING_ORDERS_UNSUPPORTED", unsupported);
      }
      return (response.orders ?? []).map(normalizePendingOrder);
    } catch (error) {
      if (error instanceof AppsInTossIapBridgeError) throw error;
      throw new AppsInTossIapBridgeError({
        cause: error,
        code: "IAP_GET_PENDING_ORDERS_FAILED",
        message: "Apps in Toss pending order restore failed.",
      });
    }
  }

  async function completeProductGrant({ orderId }: { orderId: string }) {
    const normalizedOrderId = normalizeRequiredOrderId(orderId);
    const complete = (await getIap()).completeProductGrant;
    if (!complete) {
      throw bridgeError("IAP_COMPLETE_PRODUCT_GRANT_UNAVAILABLE", "Apps in Toss IAP.completeProductGrant is not available.");
    }
    const unsupported = "Apps in Toss product grant completion is not supported in this runtime.";
    assertSupported(complete, "IAP_COMPLETE_PRODUCT_GRANT_UNSUPPORTED", unsupported);
    try {
      const result = await withIapTimeout({
        code: "IAP_COMPLETE_PRODUCT_GRANT_UNSUPPORTED",
        message: unsupported,
        promise: complete({ params: { orderId: normalizedOrderId } }),
        timeoutMs: completeProductGrantTimeoutMs,
      });
      if (result === undefined) {
        throw bridgeError("IAP_COMPLETE_PRODUCT_GRANT_UNSUPPORTED", unsupported);
      }
      if (result !== true) {
        throw bridgeError("IAP_COMPLETE_PRODUCT_GRANT_REJECTED", "Apps in Toss product grant completion was rejected.");
      }
      return true;
    } catch (error) {
      if (error instanceof AppsInTossIapBridgeError) throw error;
      throw new AppsInTossIapBridgeError({
        cause: error,
        code: "IAP_COMPLETE_PRODUCT_GRANT_FAILED",
        message: "Apps in Toss product grant completion failed.",
      });
    }
  }

  return {
    completeProductGrant,
    getPendingOrders,
    restorePendingOrders(options) {
      return restoreIapPendingOrders(options, {
        completeProductGrant: (orderId) => completeProductGrant({ orderId }),
        getPendingOrders,
        processProductGrantTimeoutMs,
      });
    },
  };
}

function bridgeError(code: AppsInTossIapBridgeErrorCode, message: string) {
  return new AppsInTossIapBridgeError({ code, message });
}

function assertSupported(
  target: { isSupported?: () => boolean },
  code: AppsInTossIapBridgeErrorCode,
  message: string,
) {
  if (!isAppsInTossBridgeSupported(target)) throw bridgeError(code, message);
}
