import { normalizeAppsInTossErrorMessage } from "@trailbase-apps-in-toss-kit/trailbase-client";
import {
  createCleanupOnce,
  isAppsInTossBridgeSupported,
  withBridgeTimeout,
} from "./internal/event-bridge";
import {
  postAppsInTossJson,
  type AppsInTossHeaders,
  type AppsInTossJsonFetcher,
} from "./internal/http";

export interface AppsInTossIapProduct {
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
  | AppsInTossIapProductGrantOutcome
  | Promise<AppsInTossIapProductGrantOutcome>;

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

export type AppsInTossIapGetPendingOrders = AppsInTossIapSupportedFunction<
  () => Promise<{ orders?: unknown[] } | undefined>
>;

export type AppsInTossIapCompleteProductGrant = AppsInTossIapSupportedFunction<
  (params: { params: { orderId: string } }) => Promise<boolean | undefined>
>;

export interface AppsInTossIapSdk {
  completeProductGrant?: AppsInTossIapCompleteProductGrant;
  createOneTimePurchaseOrder?: AppsInTossIapCreateOneTimePurchaseOrder;
  getPendingOrders?: AppsInTossIapGetPendingOrders;
  getProductItemList?: AppsInTossIapGetProductItemList;
  isSupported?: () => boolean;
}

export type AppsInTossIapBridgeErrorCode =
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
  processProductGrantTimeoutMs?: number;
  purchaseTimeoutMs?: number;
}

export interface AppsInTossIapPurchaseOneTimeOptions {
  processProductGrant: AppsInTossIapProcessProductGrant;
  processProductGrantTimeoutMs?: number;
  sku: string;
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
  error?: unknown;
  granted: boolean;
  order: AppsInTossIapPendingOrder;
}

export interface AppsInTossIapRestorePendingOrdersResult {
  failed: AppsInTossIapRestoredOrderResult[];
  orders: AppsInTossIapPendingOrder[];
  restored: AppsInTossIapRestoredOrderResult[];
  results: AppsInTossIapRestoredOrderResult[];
}

export interface AppsInTossIapBridge {
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
  processProductGrantTimeoutMs = 25_000,
  purchaseTimeoutMs = 60_000,
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
          message: "Apps in Toss product list is not supported in this runtime.",
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
        message: normalizeAppsInTossErrorMessage(
          error,
          "Apps in Toss product list request failed.",
        ),
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
      message: "Apps in Toss one-time purchase is not supported in this runtime.",
    });

    return requestOneTimePurchase({
      createOneTimePurchaseOrder,
      processProductGrant,
      processProductGrantTimeoutMs: grantTimeoutMs,
      purchaseTimeoutMs,
      sku: normalizedSku,
    });
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
        promise: completeProductGrant({ params: { orderId: normalizedOrderId } }),
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
        message: normalizeAppsInTossErrorMessage(
          error,
          "Apps in Toss product grant completion failed.",
        ),
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
      try {
        const granted = await runProductGrant({
          orderId: order.orderId,
          processProductGrant,
          providerPayload: order,
          sku: order.sku,
          source: "restore",
          timeoutMs: grantTimeoutMs,
        });
        let completed = false;
        if (granted && completeAfterGrant) {
          completed = await completeProductGrant({ orderId: order.orderId });
        }
        if (granted && completed) {
          await onProductGrantCompleted?.({
            orderId: order.orderId,
            providerPayload: order,
            sku: order.sku,
            source: "restore",
          });
        }
        results.push({ completed, granted, order });
      } catch (error) {
        const result = {
          completed: false,
          error,
          granted: false,
          order,
        };
        results.push(result);
        if (stopOnError) {
          throw error;
        }
      }
    }

    return {
      failed: results.filter((result) => !result.granted || !result.completed),
      orders,
      restored: results.filter((result) => result.granted && result.completed),
      results,
    };
  }

  async function getPendingOrders() {
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
        message: normalizeAppsInTossErrorMessage(
          error,
          "Apps in Toss pending order restore failed.",
        ),
      });
    }
  }

  return {
    completeProductGrant,
    getProducts,
    purchaseOneTime,
    restorePendingOrders,
  };
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
        ...(normalizeOptionalString(sku) ? { sku: normalizeOptionalString(sku) } : {}),
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

function requestOneTimePurchase({
  createOneTimePurchaseOrder,
  processProductGrant,
  processProductGrantTimeoutMs,
  purchaseTimeoutMs,
  sku,
}: {
  createOneTimePurchaseOrder: AppsInTossIapCreateOneTimePurchaseOrder;
  processProductGrant: AppsInTossIapProcessProductGrant;
  processProductGrantTimeoutMs: number;
  purchaseTimeoutMs: number;
  sku: string;
}) {
  return new Promise<AppsInTossIapPurchaseResult>((resolve, reject) => {
    let cleanup = createCleanupOnce();
    let settled = false;
    const clearPurchaseTimeout = withBridgeTimeout({
      onTimeout: () => {
        settleReject(
          new AppsInTossIapBridgeError({
            code: "IAP_PURCHASE_TIMEOUT",
            message: "Apps in Toss one-time purchase timed out.",
          }),
        );
      },
      timeoutMs: purchaseTimeoutMs,
    });

    try {
      const nextCleanup = createOneTimePurchaseOrder({
        onError: (error) => {
          settleReject(
            new AppsInTossIapBridgeError({
              cause: error,
              code: "IAP_PURCHASE_FAILED",
              message: normalizeAppsInTossErrorMessage(
                error,
                "Apps in Toss one-time purchase failed.",
              ),
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
                message: "Apps in Toss one-time purchase event was invalid.",
              }),
            );
            return;
          }
          try {
            settleResolve(normalizePurchaseResult(event, sku));
          } catch (error) {
            settleReject(error);
          }
        },
        options: {
          processProductGrant: async ({ orderId }) => {
            try {
              return await runProductGrant({
                orderId: normalizeRequiredOrderId(orderId),
                processProductGrant,
                providerPayload: { orderId },
                sku,
                source: "purchase",
                timeoutMs: processProductGrantTimeoutMs,
              });
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
        cleanup();
      }
    } catch (error) {
      settleReject(
        new AppsInTossIapBridgeError({
          cause: error,
          code: "IAP_PURCHASE_FAILED",
          message: normalizeAppsInTossErrorMessage(
            error,
            "Apps in Toss one-time purchase failed.",
          ),
        }),
      );
    }

    function settleResolve(result: AppsInTossIapPurchaseResult) {
      if (settled) {
        return;
      }
      settled = true;
      clearPurchaseTimeout();
      cleanup();
      resolve(result);
    }

    function settleReject(error: unknown) {
      if (settled) {
        return;
      }
      settled = true;
      clearPurchaseTimeout();
      cleanup();
      reject(error);
    }
  });
}

async function runProductGrant({
  orderId,
  processProductGrant,
  providerPayload,
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
      message: normalizeAppsInTossErrorMessage(
        error,
        "Apps in Toss product grant failed.",
      ),
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
  return {
    description: stringCandidate(record.description) ?? "",
    displayAmount: stringCandidate(record.displayAmount, record.display_amount) ?? "",
    displayName: stringCandidate(record.displayName, record.display_name) ?? "",
    iconUrl: stringCandidate(record.iconUrl, record.icon_url) ?? "",
    sku: normalizeRequiredSku(stringCandidate(record.sku)),
  };
}

function normalizePendingOrder(value: unknown): AppsInTossIapPendingOrder {
  const record = objectRecord(value);
  const sku = stringCandidate(record.sku);
  return {
    orderId: normalizeRequiredOrderId(
      stringCandidate(record.orderId, record.order_id),
    ),
    ...(stringCandidate(record.paymentCompletedDate, record.payment_completed_date)
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

function assertIapAvailable(iap?: AppsInTossIapSdk) {
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
