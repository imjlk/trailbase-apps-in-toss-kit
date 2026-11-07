import {
  AppsInTossIapBridgeError,
  normalizeOptionalString,
  normalizeRequiredOrderId,
  normalizeRequiredSku,
} from "./internal/iap";
import {
  postAppsInTossJson,
  type AppsInTossHeaders,
  type AppsInTossJsonFetcher,
} from "./internal/http";

export {
  AppsInTossIapBridgeError,
  type AppsInTossIapBridgeErrorCode,
  type AppsInTossIapBridgeErrorOptions,
} from "./internal/iap";

export interface AppsInTossIapPendingOrder {
  orderId: string;
  paymentCompletedDate?: string;
  sku: string;
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
