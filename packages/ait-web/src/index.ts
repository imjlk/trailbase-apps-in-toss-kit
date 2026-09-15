import { SdkError } from "@ait-kit/sdk";
import { createWebIdentity, createWebShare, createWebStorage } from "@ait-kit/sdk/web";
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
  // Shared loader feeding the @ait-kit/sdk web adapters (identity lookup,
  // storage, sharing): one memoized SDK load backs every delegated
  // operation, matching the local lazy-load semantics. Failures clear the
  // memo so a later call retries.
  const sharedSdkLoader = async () => {
    try {
      return { available: true as const, module: await sdk() };
    } catch (error) {
      return { available: false as const, reason: "web sdk unavailable" };
    }
  };
  const sdkIdentity = createWebIdentity({ framework: sharedSdkLoader });
  const sdkStorage = createWebStorage({ framework: sharedSdkLoader });
  const sdkShare = createWebShare({ framework: sharedSdkLoader });
  const mapSdkError = (operation: string, error: unknown): WebAdapterError =>
    error instanceof SdkError && (error.code === "SDK_UNAVAILABLE" || error.code === "UNSUPPORTED")
      ? new WebAdapterError("UNSUPPORTED", operation)
      : new WebAdapterError("SDK_ERROR", operation);
  async function invoke<T>(operation: string, action: (api: AppsInTossWebSdk) => T | Promise<T>): Promise<T> {
    try { return await action(await sdk()); }
    catch (error) { throw error instanceof WebAdapterError ? error : new WebAdapterError("SDK_ERROR", operation); }
  }
  const storageKey = (key: string) => `${appKey}.${requiredText(key, "storage key", 256)}`;
  // Storage delegated to @ait-kit/sdk's web storage adapter (lazy module
  // acquisition, verbatim keys); the appKey namespacing stays here.
  const storage: KeyValueStorage & { removeItem(key: string): Promise<void> } = {
    getItem: async key => {
      try { return await sdkStorage.get(storageKey(key)); }
      catch (error) { throw mapSdkError("storage.get", error); }
    },
    setItem: async (key, value) => {
      if (typeof value !== "string") throw new WebAdapterError("INVALID_INPUT", "storage value");
      try { await sdkStorage.set(storageKey(key), value); }
      catch (error) { throw mapSdkError("storage.set", error); }
    },
    removeItem: async key => {
      try { await sdkStorage.remove(storageKey(key)); }
      catch (error) { throw mapSdkError("storage.remove", error); }
    },
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
      // Lookup delegated to @ait-kit/sdk's web identity adapter (module
      // acquisition, HASH-shape validation); the ait: prefix policy and the
      // strict length/whitespace checks stay here.
      let hash: string;
      try {
        hash = (await sdkIdentity.getAnonymousKey()).hash;
      } catch (error) {
        // Malformed provider results keep the INVALID_RESULT category the
        // local validation used; only availability/invocation failures map
        // to UNSUPPORTED / SDK_ERROR.
        throw error instanceof SdkError && error.code === "INVALID_ANONYMOUS_KEY"
          ? new WebAdapterError("INVALID_RESULT", "anonymous identity")
          : mapSdkError("anonymous identity", error);
      }
      if (typeof hash !== "string" || !hash || hash.trim() !== hash ||
          hash.length > 4096 || /[\x00-\x1f\x7f]/.test(hash)) throw new WebAdapterError("INVALID_RESULT", "anonymous identity");
      const normalized = hash.startsWith("ait:") ? hash : `ait:${hash}`;
      if (normalized.length <= 4 || normalized.slice(4).trim() !== normalized.slice(4)) throw new WebAdapterError("INVALID_RESULT", "anonymous identity");
      return normalized;
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
      return invoke("purchase", api => purchaseFlow("purchase", eventTimeoutMs, processProductGrant, handlers =>
        required(api.IAP?.createOneTimePurchaseOrder, "purchase")({ options: { sku: product, processProductGrant: handlers.grant },
          onEvent: handlers.onEvent, onError: handlers.onError })));
    },
    async subscribe(options: WebPurchaseOptions & { offerId?: string }): Promise<IapCreateSubscriptionPurchaseOrderResult> {
      const sku = requiredText(options.sku, "subscription SKU", 256);
      if (typeof options.processProductGrant !== "function") throw new WebAdapterError("INVALID_INPUT", "subscription grant");
      const offerId = options.offerId === undefined ? undefined : requiredText(options.offerId, "subscription offer", 256);
      return invoke("subscription", api => purchaseFlow("subscription", eventTimeoutMs, options.processProductGrant, handlers =>
        required(api.IAP?.createSubscriptionPurchaseOrder, "subscription")({ options: { sku, offerId, processProductGrant: handlers.grant },
          onEvent: handlers.onEvent, onError: handlers.onError })));
    },
    getPendingOrders: () => invoke("pending orders", api => required(api.IAP?.getPendingOrders, "pending orders")()),
    getProducts: () => invoke("products", api => required(api.IAP?.getProductItemList, "products")()),
    getSubscriptionInfo: (orderId: string) => invoke("subscription status", api => required(api.IAP?.getSubscriptionInfo, "subscription status")({ params: { orderId: requiredText(orderId, "order ID", 256) } })),
    /** Call only after the backend confirms the original order's durable grant. */
    completeProductGrant: (orderId: string) => invoke("grant acknowledgement", api => required(api.IAP?.completeProductGrant, "grant acknowledgement")({ params: { orderId: requiredText(orderId, "order ID", 256) } })),
    // Sharing delegated to @ait-kit/sdk's web share adapter (intoss://
    // path validation, link pass-through, result mapping); the explicit
    // INVALID_INPUT checks stay local for API compatibility.
    createShareLink: async (path: string) => {
      if (!requiredText(path, "share path", 2048).startsWith("intoss://")) throw new WebAdapterError("INVALID_INPUT", "share path");
      try { return await sdkShare.createLink(path); }
      catch (error) {
        throw error instanceof SdkError && error.code === "INVALID_SHARE_PATH"
          ? new WebAdapterError("INVALID_INPUT", "share path")
          : mapSdkError("share link", error);
      }
    },
    /** A resolved share sheet does not prove sharing or authorize a reward. */
    share: async (message: string) => {
      const text = requiredText(message, "share message", 4096);
      let result: Awaited<ReturnType<typeof sdkShare.sendMessage>>;
      try { result = await sdkShare.sendMessage(text); }
      catch (error) { throw mapSdkError("share", error); }
      // "closed" (@ait-kit/sdk 0.2.x) and "completed" (later releases) both
      // mean the SDK share call finished; only "failed" is an error here.
      if (result.status === "failed") throw new WebAdapterError("SDK_ERROR", "share");
    },
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
interface PurchaseHandlers {
  grant: WebPurchaseOptions["processProductGrant"];
  onEvent: (event: { type: "success"; data: IapCreateOneTimePurchaseOrderResult }) => void;
  onError: (error: unknown) => void;
}
function purchaseFlow(operation: string, timeout: number, grant: WebPurchaseOptions["processProductGrant"], start: (handlers: PurchaseHandlers) => void | (() => void)): Promise<IapCreateOneTimePurchaseOrderResult> {
  return eventResult(operation, timeout, (resolve, reject) => {
    let active = true;
    let candidate: IapCreateOneTimePurchaseOrderResult | null = null;
    let grantOrderId: string | undefined;
    let grantSubscriptionId: string | undefined;
    let pendingGrant: Promise<boolean> | undefined;
    const fail = (code: WebAdapterErrorCode) => { if (active) { active = false; reject(new WebAdapterError(code, operation)); } };
    const finish = (granted: boolean) => {
      if (!active) return;
      if (!granted) { fail("SDK_ERROR"); return; }
      if (candidate && candidate.orderId === grantOrderId) { active = false; resolve(candidate); }
    };
    let cleanup: void | (() => void);
    try { cleanup = start({
      grant(input) {
        const id = input?.orderId;
        const subscriptionId = input?.subscriptionId;
        if (!active) return id === grantOrderId && subscriptionId === grantSubscriptionId && pendingGrant ? pendingGrant : false;
        if (typeof id !== "string" || !id.trim() || id.trim() !== id || id.length > 256 ||
            (grantOrderId !== undefined && (grantOrderId !== id || grantSubscriptionId !== subscriptionId)) || (candidate && candidate.orderId !== id)) {
          fail("INVALID_RESULT"); return false;
        }
        if (subscriptionId !== undefined && (typeof subscriptionId !== "string" || !subscriptionId.trim() || subscriptionId.trim() !== subscriptionId || subscriptionId.length > 256)) {
          fail("INVALID_RESULT"); return false;
        }
        // Snapshot identifiers before yielding; an SDK must not mutate a queued grant.
        const grantInput = { orderId: id, ...(subscriptionId === undefined ? {} : { subscriptionId }) };
        // Native callbacks may repeat; the backend remains idempotent across flows.
        if (pendingGrant) return pendingGrant;
        grantOrderId = id;
        grantSubscriptionId = subscriptionId;
        pendingGrant = Promise.resolve().then(() => active ? grant(grantInput) : false).then(value => value === true, () => false);
        void pendingGrant.then(finish);
        return pendingGrant;
      },
      onEvent(event) {
        if (!active) return;
        const result = event?.type === "success" ? purchaseResult(event.data) : null;
        if (!result || (grantOrderId !== undefined && grantOrderId !== result.orderId) ||
            (candidate && candidate.orderId !== result.orderId)) { fail("INVALID_RESULT"); return; }
        candidate = result;
        if (pendingGrant) void pendingGrant.then(finish);
      },
      onError: () => fail("SDK_ERROR"),
    }); } catch (error) { active = false; throw error; }
    // Always provide a disposer to stop late new grants after timeout, including
    // SDK implementations without cleanup. In-flight backend work cannot be undone.
    return () => { active = false; if (typeof cleanup === "function") cleanup(); };
  });
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
