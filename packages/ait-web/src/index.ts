import type { AppsInTossLoginResult, KeyValueStorage } from "@trailbase-apps-in-toss-kit/trailbase-client";
import type { IapCreateOneTimePurchaseOrderResult, IapCreateSubscriptionPurchaseOrderResult, NotificationAgreementResult } from "@apps-in-toss/web-framework";

type Sdk = typeof import("@apps-in-toss/web-framework");
export type AppsInTossWebSdk = Pick<Sdk, "Storage" | "TossAuth" | "User" | "Notification" | "IAP" | "Share">;
export type WebAdapterErrorCode = "INVALID_INPUT" | "UNSUPPORTED" | "SDK_ERROR" | "INVALID_RESULT" | "TIMEOUT";
export class WebAdapterError extends Error {
  constructor(public readonly code: WebAdapterErrorCode, public readonly operation: string) {
    super(`Apps in Toss Web ${operation}: ${code}`);
    this.name = "WebAdapterError";
  }
}
export interface WebNotificationAgreement {
  result: NotificationAgreementResult;
  status: "OPTED_IN" | "OPTED_OUT";
  source: "apps_in_toss_sdk";
  template_code: string;
  templateCode: string;
}
export interface CreateAppsInTossWebAdapterOptions {
  appKey: string;
  /** Explicit dependency injection for reference tests. No implicit browser stub. */
  loadSdk?: () => Promise<AppsInTossWebSdk>;
  eventTimeoutMs?: number;
}
export interface WebPurchaseOptions {
  sku: string;
  /** Verify and persist an idempotent grant on the backend; return true only then. */
  processProductGrant: (input: { orderId: string; subscriptionId?: string }) => boolean | Promise<boolean>;
}

/** Lazy SDK 3 namespaces; no React Native imports or localStorage migration. */
export function createAppsInTossWebAdapter({ appKey, loadSdk = () => import("@apps-in-toss/web-framework"), eventTimeoutMs = 120_000 }: CreateAppsInTossWebAdapterOptions) {
  if (typeof appKey !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(appKey) ||
      !Number.isInteger(eventTimeoutMs) || eventTimeoutMs < 1 || eventTimeoutMs > 600_000) {
    throw new WebAdapterError("INVALID_INPUT", "configuration");
  }
  let sdkPromise: Promise<AppsInTossWebSdk> | undefined;
  const sdk = () => sdkPromise ??= loadSdk().catch(() => { sdkPromise = undefined; throw new WebAdapterError("UNSUPPORTED", "load"); });
  async function invoke<T>(operation: string, action: (api: AppsInTossWebSdk) => T | Promise<T>): Promise<T> {
    try { return await action(await sdk()); }
    catch (error) { throw error instanceof WebAdapterError ? error : new WebAdapterError("SDK_ERROR", operation); }
  }
  const storageKey = (key: string) => `${appKey}.${requiredText(key, "storage key", 256)}`;
  const storage: KeyValueStorage & { removeItem(key: string): Promise<void> } = {
    getItem: key => invoke("storage.get", api => required(api.Storage?.getItem, "storage.get")(storageKey(key))),
    setItem: (key, value) => invoke("storage.set", api => {
      if (typeof value !== "string") throw new WebAdapterError("INVALID_INPUT", "storage value");
      return required(api.Storage?.setItem, "storage.set")(storageKey(key), value);
    }),
    removeItem: key => invoke("storage.remove", api => required(api.Storage?.removeItem, "storage.remove")(storageKey(key))),
  };
  return {
    storage,
    async login(): Promise<AppsInTossLoginResult> {
      return invoke("login", async api => {
        const result = await required(api.TossAuth?.login, "login")();
        if (!result || typeof result.authorizationCode !== "string" || !result.authorizationCode.trim() ||
            typeof result.referrer !== "string" || !result.referrer.trim() || result.referrer.length > 64) throw new WebAdapterError("INVALID_RESULT", "login");
        // SANDBOX remains a real one-time code; always exchange through the backend.
        return result;
      });
    },
    async anonymousHash(): Promise<string> {
      return invoke("anonymous identity", async api => {
        const result = await required(api.User?.getAnonymousKey, "anonymous identity")();
        const hash = result?.hash;
        if (result?.type !== "HASH" || typeof hash !== "string" || !hash || hash.trim() !== hash ||
            hash.length > 4096 || /[\x00-\x1f\x7f]/.test(hash)) throw new WebAdapterError("INVALID_RESULT", "anonymous identity");
        const normalized = hash.startsWith("ait:") ? hash : `ait:${hash}`;
        if (normalized.length <= 4 || normalized.slice(4).trim() !== normalized.slice(4)) throw new WebAdapterError("INVALID_RESULT", "anonymous identity");
        return normalized;
      });
    },
    async requestNotificationAgreement(templateCode: string): Promise<WebNotificationAgreement> {
      const code = requiredText(templateCode, "notification template", 256);
      return invoke("notification agreement", api => eventResult<WebNotificationAgreement>("notification agreement", eventTimeoutMs, (resolve, reject) =>
        required(api.Notification?.requestAgreement, "notification agreement")({
          options: { templateCode: code },
          onEvent: event => {
            if (!["newAgreement", "alreadyAgreed", "agreementRejected"].includes(event?.type)) {
              reject(new WebAdapterError("INVALID_RESULT", "notification agreement")); return;
            }
            resolve({ result: event.type, status: event.type === "agreementRejected" ? "OPTED_OUT" : "OPTED_IN",
              source: "apps_in_toss_sdk", template_code: code, templateCode: code });
          }, onError: reject,
        })));
    },
    async purchase({ sku, processProductGrant }: WebPurchaseOptions): Promise<IapCreateOneTimePurchaseOrderResult> {
      const product = requiredText(sku, "purchase SKU", 256);
      if (typeof processProductGrant !== "function") throw new WebAdapterError("INVALID_INPUT", "purchase grant");
      return invoke("purchase", api => eventResult("purchase", eventTimeoutMs, (resolve, reject) =>
        required(api.IAP?.createOneTimePurchaseOrder, "purchase")({ options: { sku: product, processProductGrant: grantCallback(processProductGrant) },
          onEvent: event => { const result = event?.type === "success" ? purchaseResult(event.data) : null; if (result) resolve(result); else reject(new WebAdapterError("INVALID_RESULT", "purchase")); }, onError: reject })));
    },
    async subscribe(options: WebPurchaseOptions & { offerId?: string }): Promise<IapCreateSubscriptionPurchaseOrderResult> {
      const sku = requiredText(options.sku, "subscription SKU", 256);
      if (typeof options.processProductGrant !== "function") throw new WebAdapterError("INVALID_INPUT", "subscription grant");
      const offerId = options.offerId === undefined ? undefined : requiredText(options.offerId, "subscription offer", 256);
      return invoke("subscription", api => eventResult("subscription", eventTimeoutMs, (resolve, reject) =>
        required(api.IAP?.createSubscriptionPurchaseOrder, "subscription")({ options: { sku, offerId, processProductGrant: grantCallback(options.processProductGrant) },
          onEvent: event => { const result = event?.type === "success" ? purchaseResult(event.data) : null; if (result) resolve(result); else reject(new WebAdapterError("INVALID_RESULT", "subscription")); }, onError: reject })));
    },
    getPendingOrders: () => invoke("pending orders", api => required(api.IAP?.getPendingOrders, "pending orders")()),
    getProducts: () => invoke("products", api => required(api.IAP?.getProductItemList, "products")()),
    getSubscriptionInfo: (orderId: string) => invoke("subscription status", api => required(api.IAP?.getSubscriptionInfo, "subscription status")({ params: { orderId: requiredText(orderId, "order ID", 256) } })),
    /** Call only after the backend confirms the original order's durable grant. */
    completeProductGrant: (orderId: string) => invoke("grant acknowledgement", api => required(api.IAP?.completeProductGrant, "grant acknowledgement")({ params: { orderId: requiredText(orderId, "order ID", 256) } })),
    createShareLink: (path: string) => invoke("share link", api => {
      if (!requiredText(path, "share path", 2048).startsWith("intoss://")) throw new WebAdapterError("INVALID_INPUT", "share path");
      return required(api.Share?.createLink, "share link")({ path });
    }),
    /** A resolved share sheet does not prove sharing or authorize a reward. */
    share: (message: string) => invoke("share", api => required(api.Share?.sendMessage, "share")({ message: requiredText(message, "share message", 4096) })),
  };
}
export type AppsInTossWebAdapter = ReturnType<typeof createAppsInTossWebAdapter>;

function required<T extends (...args: never[]) => unknown>(fn: T | undefined, operation: string): T {
  if (typeof fn !== "function") throw new WebAdapterError("UNSUPPORTED", operation);
  const supported = (fn as T & { isSupported?: () => boolean }).isSupported;
  if (supported && supported() !== true) throw new WebAdapterError("UNSUPPORTED", operation);
  return fn;
}
function purchaseResult(value: unknown): IapCreateOneTimePurchaseOrderResult | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const data = value as Record<string, unknown>;
  const orderId = data.orderId ?? data.order_id;
  if (typeof orderId !== "string" || !orderId.trim() || orderId.trim() !== orderId || orderId.length > 256) return null;
  return { ...data, orderId } as unknown as IapCreateOneTimePurchaseOrderResult;
}
function grantCallback(grant: WebPurchaseOptions["processProductGrant"]): WebPurchaseOptions["processProductGrant"] {
  return async input => { try { return (await grant(input)) === true; } catch { return false; } };
}
function requiredText(value: string, operation: string, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > max || value.trim() !== value) throw new WebAdapterError("INVALID_INPUT", operation);
  return value;
}
function eventResult<T>(operation: string, timeout: number, subscribe: (resolve: (value: T) => void, reject: (error: unknown) => void) => (void | (() => void))): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false; let cleanup: (() => void) | undefined; let disposed = false;
    const dispose = () => { if (cleanup && !disposed) { disposed = true; try { cleanup(); } catch { /* No second result from cleanup. */ } } };
    const finish = (ok: boolean, value: unknown) => {
      if (settled) return;
      settled = true; clearTimeout(timer); dispose();
      if (ok) resolve(value as T);
      else reject(value instanceof WebAdapterError ? value : new WebAdapterError("SDK_ERROR", operation));
    };
    const timer = setTimeout(() => finish(false, new WebAdapterError("TIMEOUT", operation)), timeout);
    try {
      const subscription = subscribe(value => finish(true, value), error => finish(false, error));
      cleanup = typeof subscription === "function" ? subscription : undefined;
      if (settled) dispose(); // SDK can fire synchronously before returning cleanup.
    } catch (error) { finish(false, error); }
  });
}
