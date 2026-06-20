export type AnalyticsPayloadValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | AnalyticsPayloadValue[]
  | { [key: string]: AnalyticsPayloadValue };

export type AnalyticsPayload = Record<string, AnalyticsPayloadValue>;

export interface AnalyticsTrackOptions {
  screen?: string | null;
  sessionToken?: string | null;
  source?: string | null;
  clientCreatedAt?: number;
}

export interface AnalyticsEvent<
  TEventName extends string = string,
  TPayload extends AnalyticsPayload = AnalyticsPayload,
> {
  eventName: TEventName;
  eventPayload: TPayload;
  screen?: string | null;
  sessionToken?: string | null;
  source?: string | null;
  clientCreatedAt: number;
}

export interface AnalyticsSinkContext {
  sink: "detail" | "appsInToss" | "debug";
}

export type AnalyticsSinkResult = void | Promise<void>;

export type DetailAnalyticsConfig<
  TEventName extends string = string,
  TPayload extends AnalyticsPayload = AnalyticsPayload,
> =
  | false
  | {
      enabled: true;
      enqueueBatch: (
        events: Array<AnalyticsEvent<TEventName, TPayload>>,
        context: AnalyticsSinkContext,
      ) => AnalyticsSinkResult;
      flush?: () => AnalyticsSinkResult;
      sessionTokenProvider?: () => string | null | undefined;
    };

export interface AppsInTossLoggerParams {
  log_name: string;
  log_type: string;
  params: AnalyticsPayload;
}

export interface AppsInTossAnalyticsModule {
  init?: (options: {
    debug?: boolean;
    logger: (params: AppsInTossLoggerParams) => void;
  }) => void;
}

export interface AppsInTossMappedEvent {
  name: string;
  type: "screen" | "press" | "impression" | "area" | "custom";
  params?: AnalyticsPayload;
}

export type AppsInTossAnalyticsConfig<
  TEventName extends string = string,
  TPayload extends AnalyticsPayload = AnalyticsPayload,
> =
  | false
  | {
      enabled: true;
      analyticsModule?: AppsInTossAnalyticsModule | null | (() => AppsInTossAnalyticsModule | null);
      debug?: boolean;
      mapEvent?: (
        event: AnalyticsEvent<TEventName, TPayload>,
      ) => AppsInTossMappedEvent | false | null | undefined;
      dispatch?: (
        event: AppsInTossMappedEvent,
        originalEvent: AnalyticsEvent<TEventName, TPayload>,
      ) => AnalyticsSinkResult;
      captureSdkLoggerToDetail?: boolean;
    };

export type DebugAnalyticsConfig<
  TEventName extends string = string,
  TPayload extends AnalyticsPayload = AnalyticsPayload,
> =
  | false
  | {
      enabled: true;
      logger: (
        event: AnalyticsEvent<TEventName, TPayload>,
        context: AnalyticsSinkContext,
      ) => AnalyticsSinkResult;
    };

export interface AnalyticsRouterConfig<
  TEventName extends string = string,
  TPayload extends AnalyticsPayload = AnalyticsPayload,
> {
  detail?: DetailAnalyticsConfig<TEventName, TPayload>;
  appsInToss?: AppsInTossAnalyticsConfig<TEventName, TPayload>;
  debug?: DebugAnalyticsConfig<TEventName, TPayload>;
  screen?: string | null;
  sessionToken?: string | null;
  onError?: (error: unknown, context: AnalyticsSinkContext) => void;
}

export interface AnalyticsRouter<
  TEventName extends string = string,
  TPayload extends AnalyticsPayload = AnalyticsPayload,
> {
  configure: (config: Partial<AnalyticsRouterConfig<TEventName, TPayload>>) => void;
  track: (
    eventName: TEventName,
    payload?: TPayload,
    options?: AnalyticsTrackOptions,
  ) => void;
  flush: () => Promise<void>;
}

export interface TrailBaseAnalyticsBootstrapPolicy {
  enabled?: boolean;
  endpoint?: string;
  sampleRate?: number;
  maxBatchSize?: number;
  maxQueueSize?: number;
  flushIntervalMs?: number;
  maxPayloadBytes?: number;
  allowedEvents?: string[];
}

export interface AppsInTossAnalyticsBootstrapPolicy {
  enabled?: boolean;
  allowedEvents?: string[];
}

export interface AnalyticsBootstrapPolicy {
  enabled?: boolean;
  trailbase?: TrailBaseAnalyticsBootstrapPolicy | null;
  appsInToss?: AppsInTossAnalyticsBootstrapPolicy | null;
}

export interface NormalizedTrailBaseAnalyticsBootstrapPolicy {
  enabled: boolean;
  endpoint: string | null;
  sampleRate: number;
  maxBatchSize: number;
  maxQueueSize: number;
  flushIntervalMs: number;
  maxPayloadBytes: number;
  allowedEvents?: string[];
}

export interface NormalizedAppsInTossAnalyticsBootstrapPolicy {
  enabled: boolean;
  allowedEvents?: string[];
}

export interface NormalizedAnalyticsBootstrapPolicy {
  enabled: boolean;
  trailbase: NormalizedTrailBaseAnalyticsBootstrapPolicy;
  appsInToss: NormalizedAppsInTossAnalyticsBootstrapPolicy;
}

export type AnalyticsHeaders = Headers | Record<string, string> | [string, string][];

export type AnalyticsFetcher = (
  input: string,
  init: RequestInit,
) => Promise<Response>;

export interface TrailBaseAnalyticsEventClientOptions {
  baseUrl?: string;
  endpoint: string;
  fetcher?: AnalyticsFetcher;
  getAuthHeaders?: () => AnalyticsHeaders | null | undefined | Promise<AnalyticsHeaders | null | undefined>;
}

export interface TrailBaseAnalyticsEventClient<
  TEventName extends string = string,
  TPayload extends AnalyticsPayload = AnalyticsPayload,
> {
  enqueueBatch: (
    events: Array<AnalyticsEvent<TEventName, TPayload>>,
    context?: AnalyticsSinkContext,
  ) => Promise<void>;
}

export interface BufferedAnalyticsSinkOptions<
  TEventName extends string = string,
  TPayload extends AnalyticsPayload = AnalyticsPayload,
> {
  enqueueBatch: (
    events: Array<AnalyticsEvent<TEventName, TPayload>>,
    context: AnalyticsSinkContext,
  ) => AnalyticsSinkResult;
  maxBatchSize?: number;
  maxQueueSize?: number;
  flushIntervalMs?: number;
  sampleRate?: number;
  allowedEvents?: readonly string[];
  maxPayloadBytes?: number;
  redactKeys?: readonly string[];
  random?: () => number;
}

export interface BufferedAnalyticsSink<
  TEventName extends string = string,
  TPayload extends AnalyticsPayload = AnalyticsPayload,
> {
  enqueueBatch: (
    events: Array<AnalyticsEvent<TEventName, TPayload>>,
    context: AnalyticsSinkContext,
  ) => AnalyticsSinkResult;
  flush: () => Promise<void>;
  clear: () => void;
  getQueueSize: () => number;
}

export interface SanitizeAnalyticsPayloadOptions {
  maxPayloadBytes?: number;
  redactKeys?: readonly string[];
}

export interface ConfigureAnalyticsRouterFromBootstrapOptions<
  TEventName extends string = string,
  TPayload extends AnalyticsPayload = AnalyticsPayload,
> {
  router: AnalyticsRouter<TEventName, TPayload>;
  policy: unknown;
  trailbase?: Omit<TrailBaseAnalyticsEventClientOptions, "endpoint"> & {
    endpoint?: string;
  };
  sessionTokenProvider?: () => string | null | undefined;
}

export class AnalyticsSinkRequestError extends Error {
  status: number;
  statusText: string;
  payload: unknown;

  constructor(message: string, options: { status: number; statusText: string; payload: unknown }) {
    super(message);
    this.name = "AnalyticsSinkRequestError";
    this.status = options.status;
    this.statusText = options.statusText;
    this.payload = options.payload;
  }
}

export const DEFAULT_ANALYTICS_SAMPLE_RATE = 1;
export const DEFAULT_ANALYTICS_MAX_BATCH_SIZE = 20;
export const DEFAULT_ANALYTICS_MAX_QUEUE_SIZE = 200;
export const DEFAULT_ANALYTICS_FLUSH_INTERVAL_MS = 5_000;
export const DEFAULT_ANALYTICS_MAX_PAYLOAD_BYTES = 4_096;

const DEFAULT_REDACT_KEYS = [
  "authorization",
  "authorizationCode",
  "authToken",
  "refreshToken",
  "csrfToken",
  "accessToken",
  "idToken",
  "sessionToken",
  "token",
  "secret",
  "password",
  "mtlsProxyToken",
  "clientCert",
  "privateKey",
  "userKey",
  "rawUserKey",
  "tossUserKey",
  "toss_user_key",
  "user_key",
  "hmac",
  "sealed",
  "promotionCode",
];

const configuredBufferedSinks = new WeakMap<
  AnalyticsRouter<string, AnalyticsPayload>,
  { clear: () => void }
>();

export function createAnalyticsRouter<
  TEventName extends string = string,
  TPayload extends AnalyticsPayload = AnalyticsPayload,
>(
  initialConfig: AnalyticsRouterConfig<TEventName, TPayload> = {},
): AnalyticsRouter<TEventName, TPayload> {
  let config: AnalyticsRouterConfig<TEventName, TPayload> = {
    detail: false,
    appsInToss: false,
    debug: false,
    ...initialConfig,
  };
  let appsInTossInitialized = false;
  let pending: Promise<void>[] = [];

  function configure(nextConfig: Partial<AnalyticsRouterConfig<TEventName, TPayload>>) {
    config = {
      ...config,
      ...nextConfig,
    };
    initializeAppsInToss();
  }

  function track(
    eventName: TEventName,
    payload = {} as TPayload,
    options: AnalyticsTrackOptions = {},
  ) {
    const event: AnalyticsEvent<TEventName, TPayload> = {
      eventName,
      eventPayload: payload,
      screen: optionOrFallback(options, "screen", config.screen ?? null),
      sessionToken: optionOrFallback(
        options,
        "sessionToken",
        resolveSessionToken(config.detail) ?? config.sessionToken ?? null,
      ),
      source: options.source ?? null,
      clientCreatedAt: options.clientCreatedAt ?? Date.now(),
    };

    sendToDetail(event);
    sendToAppsInToss(event);
    sendToDebug(event);
  }

  async function flush() {
    await drainPending();
    const detail = config.detail;
    if (isEnabled(detail) && detail.flush) {
      captureSinkCall(() => detail.flush?.(), { sink: "detail" });
    }
    await drainPending();
  }

  async function drainPending() {
    while (pending.length > 0) {
      const current = pending;
      pending = [];
      await Promise.allSettled(current);
    }
  }

  function initializeAppsInToss() {
    const appsInToss = config.appsInToss;
    if (!isEnabled(appsInToss) || appsInTossInitialized) {
      return;
    }
    try {
      const module = resolveAppsInTossModule(appsInToss.analyticsModule);
      if (!module) {
        return;
      }
      module.init?.({
        debug: appsInToss.debug,
        logger: (params) => {
          if (appsInToss.captureSdkLoggerToDetail !== false) {
            sendToDetail({
              eventName: params.log_name as TEventName,
              eventPayload: {
                ...params.params,
                appsInTossLogType: params.log_type,
              } as unknown as TPayload,
              screen: config.screen ?? null,
              sessionToken: resolveSessionToken(config.detail) ?? config.sessionToken ?? null,
              source: "apps-in-toss-sdk",
              clientCreatedAt: Date.now(),
            });
          }
        },
      });
      appsInTossInitialized = true;
    } catch (error) {
      reportError(error, { sink: "appsInToss" });
    }
  }

  function sendToDetail(event: AnalyticsEvent<TEventName, TPayload>) {
    const detail = config.detail;
    if (!isEnabled(detail)) {
      return;
    }
    captureSinkCall(() => detail.enqueueBatch([event], { sink: "detail" }), {
      sink: "detail",
    });
  }

  function sendToAppsInToss(event: AnalyticsEvent<TEventName, TPayload>) {
    const appsInToss = config.appsInToss;
    if (!isEnabled(appsInToss)) {
      return;
    }
    captureSinkCall(
      () => {
        initializeAppsInToss();
        const mapped = appsInToss.mapEvent?.(event);
        if (!mapped || !appsInToss.dispatch) {
          return;
        }
        return appsInToss.dispatch(mapped, event);
      },
      {
        sink: "appsInToss",
      },
    );
  }

  function sendToDebug(event: AnalyticsEvent<TEventName, TPayload>) {
    const debug = config.debug;
    if (!isEnabled(debug)) {
      return;
    }
    captureSinkCall(() => debug.logger(event, { sink: "debug" }), {
      sink: "debug",
    });
  }

  function captureSinkCall(
    call: () => AnalyticsSinkResult,
    context: AnalyticsSinkContext,
  ) {
    try {
      captureSinkResult(call(), context);
    } catch (error) {
      reportError(error, context);
    }
  }

  function captureSinkResult(result: AnalyticsSinkResult, context: AnalyticsSinkContext) {
    if (!isPromiseLike(result)) {
      return;
    }
    pending.push(
      result.catch((error) => {
        reportError(error, context);
      }),
    );
  }

  function reportError(error: unknown, context: AnalyticsSinkContext) {
    config.onError?.(error, context);
  }

  initializeAppsInToss();

  return {
    configure,
    track,
    flush,
  };
}

export function normalizeAnalyticsBootstrapPolicy(
  value: unknown,
): NormalizedAnalyticsBootstrapPolicy {
  const policy = isRecord(value) ? value : {};
  const enabled = policy.enabled === true;
  const trailbase = normalizeTrailBaseAnalyticsPolicy(enabled ? policy.trailbase : null);
  const appsInToss = normalizeAppsInTossAnalyticsPolicy(enabled ? policy.appsInToss : null);

  return {
    enabled,
    trailbase,
    appsInToss,
  };
}

function normalizeBootstrapPolicyWithOverrides(
  value: unknown,
  endpointOverride: string | undefined,
): NormalizedAnalyticsBootstrapPolicy {
  const policy = normalizeAnalyticsBootstrapPolicy(value);
  const endpoint = normalizeOptionalEndpoint(endpointOverride) ?? policy.trailbase.endpoint;
  if (
    policy.enabled &&
    endpoint &&
    (policy.trailbase.enabled || isRawTrailBaseAnalyticsPolicyEnabled(value))
  ) {
    return {
      ...policy,
      trailbase: {
        ...policy.trailbase,
        enabled: true,
        endpoint,
      },
    };
  }
  return policy;
}

export function configureAnalyticsRouterFromBootstrap<
  TEventName extends string = string,
  TPayload extends AnalyticsPayload = AnalyticsPayload,
>(
  options: ConfigureAnalyticsRouterFromBootstrapOptions<TEventName, TPayload>,
): NormalizedAnalyticsBootstrapPolicy {
  const policy = normalizeBootstrapPolicyWithOverrides(
    options.policy,
    options.trailbase?.endpoint,
  );
  const nextConfig: Partial<AnalyticsRouterConfig<TEventName, TPayload>> = {
    detail: false,
    appsInToss: false,
    debug: false,
  };
  clearConfiguredBufferedSink(options.router);

  if (policy.enabled && policy.trailbase.enabled && policy.trailbase.endpoint) {
    const endpoint = normalizeOptionalEndpoint(options.trailbase?.endpoint) ?? policy.trailbase.endpoint;
    const client = createTrailBaseAnalyticsEventClient<TEventName, TPayload>({
      baseUrl: options.trailbase?.baseUrl,
      endpoint,
      fetcher: options.trailbase?.fetcher,
      getAuthHeaders: options.trailbase?.getAuthHeaders,
    });
    const sink = createBufferedAnalyticsSink<TEventName, TPayload>({
      enqueueBatch: client.enqueueBatch,
      maxBatchSize: policy.trailbase.maxBatchSize,
      maxQueueSize: policy.trailbase.maxQueueSize,
      flushIntervalMs: policy.trailbase.flushIntervalMs,
      sampleRate: policy.trailbase.sampleRate,
      allowedEvents: policy.trailbase.allowedEvents,
      maxPayloadBytes: policy.trailbase.maxPayloadBytes,
    });
    nextConfig.detail = {
      enabled: true,
      enqueueBatch: sink.enqueueBatch,
      flush: sink.flush,
      sessionTokenProvider: options.sessionTokenProvider,
    };
    configuredBufferedSinks.set(
      options.router as unknown as AnalyticsRouter<string, AnalyticsPayload>,
      sink,
    );
  }

  options.router.configure(nextConfig);
  return policy;
}

export function createTrailBaseAnalyticsEventClient<
  TEventName extends string = string,
  TPayload extends AnalyticsPayload = AnalyticsPayload,
>(
  options: TrailBaseAnalyticsEventClientOptions,
): TrailBaseAnalyticsEventClient<TEventName, TPayload> {
  const endpoint = normalizeEndpoint(options.endpoint);

  return {
    async enqueueBatch(events) {
      if (events.length === 0) {
        return;
      }
      const fetcher = options.fetcher ?? globalThis.fetch;
      if (!fetcher) {
        throw new Error("A fetch implementation is required for analytics events");
      }
      const headers = mergeAnalyticsHeaders(
        { "Content-Type": "application/json" },
        await options.getAuthHeaders?.(),
      );
      const response = await fetcher(resolveAnalyticsEndpoint(options.baseUrl, endpoint), {
        method: "POST",
        headers,
        body: JSON.stringify({ events }),
      });
      if (response.ok) {
        return;
      }
      const payload = await readAnalyticsErrorPayload(response);
      throw new AnalyticsSinkRequestError(
        normalizeAnalyticsRequestError(payload, response.statusText),
        {
          status: response.status,
          statusText: response.statusText,
          payload,
        },
      );
    },
  };
}

export function createBufferedAnalyticsSink<
  TEventName extends string = string,
  TPayload extends AnalyticsPayload = AnalyticsPayload,
>(
  options: BufferedAnalyticsSinkOptions<TEventName, TPayload>,
): BufferedAnalyticsSink<TEventName, TPayload> {
  const maxBatchSize = positiveIntegerOrDefault(
    options.maxBatchSize,
    DEFAULT_ANALYTICS_MAX_BATCH_SIZE,
  );
  const maxQueueSize = positiveIntegerOrDefault(
    options.maxQueueSize,
    DEFAULT_ANALYTICS_MAX_QUEUE_SIZE,
  );
  const flushIntervalMs = nonNegativeIntegerOrDefault(
    options.flushIntervalMs,
    DEFAULT_ANALYTICS_FLUSH_INTERVAL_MS,
  );
  const sampleRate = normalizeSampleRate(options.sampleRate);
  const allowedEvents = toAllowedEventsSet(options.allowedEvents);
  const random = options.random ?? Math.random;
  const context: AnalyticsSinkContext = { sink: "detail" };
  let queue: Array<AnalyticsEvent<TEventName, TPayload>> = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let flushPromise: Promise<void> | null = null;
  let clearVersion = 0;

  function enqueueBatch(events: Array<AnalyticsEvent<TEventName, TPayload>>) {
    for (const event of events) {
      if (!isAllowedEvent(event.eventName, allowedEvents)) {
        continue;
      }
      if (sampleRate <= 0 || random() >= sampleRate) {
        continue;
      }
      queue.push(sanitizeAnalyticsEvent(event, options));
    }
    trimQueue();
    if (queue.length >= maxBatchSize) {
      return flush();
    }
    scheduleFlush();
  }

  async function flush() {
    if (flushPromise) {
      return flushPromise;
    }
    clearTimer();
    const flushVersion = clearVersion;
    flushPromise = (async () => {
      while (queue.length > 0) {
        const batch = queue.splice(0, maxBatchSize);
        try {
          await options.enqueueBatch(batch, context);
        } catch (error) {
          if (flushVersion === clearVersion) {
            queue = [...batch, ...queue].slice(0, maxQueueSize);
            scheduleFlush();
          }
          throw error;
        }
      }
    })();
    try {
      await flushPromise;
    } finally {
      flushPromise = null;
      if (queue.length > 0) {
        scheduleFlush();
      }
    }
  }

  function clear() {
    clearVersion += 1;
    queue = [];
    clearTimer();
  }

  function getQueueSize() {
    return queue.length;
  }

  function trimQueue() {
    if (queue.length <= maxQueueSize) {
      return;
    }
    queue = queue.slice(queue.length - maxQueueSize);
  }

  function scheduleFlush() {
    if (flushIntervalMs <= 0 || queue.length === 0 || timer) {
      return;
    }
    timer = setTimeout(() => {
      timer = null;
      void flush().catch(() => {
        // The router captures explicit flush errors; interval retries keep the queue in memory.
      });
    }, flushIntervalMs);
  }

  function clearTimer() {
    if (!timer) {
      return;
    }
    clearTimeout(timer);
    timer = null;
  }

  return {
    enqueueBatch,
    flush,
    clear,
    getQueueSize,
  };
}

export function sanitizeAnalyticsPayload(
  payload: unknown,
  options: SanitizeAnalyticsPayloadOptions = {},
): AnalyticsPayload {
  const sanitized = sanitizeObjectPayload(payload, options, new WeakSet<object>());
  const bytes = jsonByteLength(sanitized);
  const maxPayloadBytes = positiveIntegerOrDefault(
    options.maxPayloadBytes,
    DEFAULT_ANALYTICS_MAX_PAYLOAD_BYTES,
  );
  if (bytes <= maxPayloadBytes) {
    return sanitized;
  }
  return {
    analyticsPayloadTruncated: true,
    analyticsPayloadBytes: bytes,
  };
}

function normalizeTrailBaseAnalyticsPolicy(
  value: unknown,
): NormalizedTrailBaseAnalyticsBootstrapPolicy {
  const policy = isRecord(value) ? value : {};
  const endpoint = typeof policy.endpoint === "string" ? policy.endpoint.trim() : "";
  const enabled = policy.enabled === true && endpoint.length > 0;
  return {
    enabled,
    endpoint: enabled ? endpoint : null,
    sampleRate: normalizeSampleRate(policy.sampleRate),
    maxBatchSize: positiveIntegerOrDefault(
      policy.maxBatchSize,
      DEFAULT_ANALYTICS_MAX_BATCH_SIZE,
    ),
    maxQueueSize: positiveIntegerOrDefault(
      policy.maxQueueSize,
      DEFAULT_ANALYTICS_MAX_QUEUE_SIZE,
    ),
    flushIntervalMs: nonNegativeIntegerOrDefault(
      policy.flushIntervalMs,
      DEFAULT_ANALYTICS_FLUSH_INTERVAL_MS,
    ),
    maxPayloadBytes: positiveIntegerOrDefault(
      policy.maxPayloadBytes,
      DEFAULT_ANALYTICS_MAX_PAYLOAD_BYTES,
    ),
    allowedEvents: normalizeAllowedEvents(policy.allowedEvents),
  };
}

function normalizeAppsInTossAnalyticsPolicy(
  value: unknown,
): NormalizedAppsInTossAnalyticsBootstrapPolicy {
  const policy = isRecord(value) ? value : {};
  return {
    enabled: policy.enabled === true,
    allowedEvents: normalizeAllowedEvents(policy.allowedEvents),
  };
}

function normalizeAllowedEvents(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") {
      continue;
    }
    const eventName = item.trim();
    if (eventName) {
      seen.add(eventName);
    }
  }
  return [...seen];
}

function isRawTrailBaseAnalyticsPolicyEnabled(value: unknown): boolean {
  if (!isRecord(value) || value.enabled !== true || !isRecord(value.trailbase)) {
    return false;
  }
  return value.trailbase.enabled === true;
}

function clearConfiguredBufferedSink<
  TEventName extends string,
  TPayload extends AnalyticsPayload,
>(router: AnalyticsRouter<TEventName, TPayload>) {
  const key = router as unknown as AnalyticsRouter<string, AnalyticsPayload>;
  configuredBufferedSinks.get(key)?.clear();
  configuredBufferedSinks.delete(key);
}

function toAllowedEventsSet(value: readonly string[] | undefined): Set<string> | null {
  if (value === undefined) {
    return null;
  }
  return new Set(value);
}

function isAllowedEvent(eventName: string, allowedEvents: Set<string> | null): boolean {
  return allowedEvents === null || allowedEvents.has(eventName);
}

function normalizeSampleRate(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_ANALYTICS_SAMPLE_RATE;
  }
  if (value <= 0) {
    return 0;
  }
  if (value >= 1) {
    return 1;
  }
  return value;
}

function positiveIntegerOrDefault(value: unknown, fallback: number): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value < 1
  ) {
    return fallback;
  }
  return value;
}

function nonNegativeIntegerOrDefault(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return fallback;
  }
  return Math.floor(value);
}

function normalizeEndpoint(value: string): string {
  const endpoint = value.trim();
  if (!endpoint) {
    throw new Error("Analytics endpoint is required");
  }
  return endpoint;
}

function normalizeOptionalEndpoint(value: string | undefined): string | null {
  if (value === undefined) {
    return null;
  }
  const endpoint = value.trim();
  return endpoint || null;
}

function resolveAnalyticsEndpoint(baseUrl: string | undefined, endpoint: string): string {
  if (/^https?:\/\//i.test(endpoint) || !baseUrl) {
    return endpoint;
  }
  return `${baseUrl.replace(/\/+$/, "")}/${endpoint.replace(/^\/+/, "")}`;
}

function mergeAnalyticsHeaders(
  baseHeaders: Record<string, string>,
  authHeaders: AnalyticsHeaders | null | undefined,
): Headers {
  const headers = new Headers(baseHeaders);
  appendAnalyticsHeaders(headers, authHeaders);
  return headers;
}

function appendAnalyticsHeaders(headers: Headers, value: AnalyticsHeaders | null | undefined) {
  if (!value) {
    return;
  }
  if (typeof Headers !== "undefined" && value instanceof Headers) {
    value.forEach((headerValue, headerName) => {
      headers.set(headerName, headerValue);
    });
    return;
  }
  if (Array.isArray(value)) {
    for (const [headerName, headerValue] of value) {
      headers.set(headerName, headerValue);
    }
    return;
  }
  for (const [headerName, headerValue] of Object.entries(value)) {
    headers.set(headerName, headerValue);
  }
}

async function readAnalyticsErrorPayload(response: Response): Promise<unknown> {
  const text = await response.text().catch(() => "");
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function normalizeAnalyticsRequestError(payload: unknown, fallback = "Analytics request failed"): string {
  if (typeof payload === "string" && payload.trim()) {
    return payload;
  }
  if (isRecord(payload)) {
    const candidates = [payload.message, payload.error, payload.reason, payload.detail];
    for (const candidate of candidates) {
      if (typeof candidate === "string" && candidate.trim()) {
        return candidate;
      }
    }
  }
  return fallback;
}

function sanitizeObjectPayload(
  payload: unknown,
  options: SanitizeAnalyticsPayloadOptions,
  seen: WeakSet<object>,
): AnalyticsPayload {
  if (!isRecord(payload)) {
    return {};
  }
  const sanitized: AnalyticsPayload = {};
  for (const [key, value] of Object.entries(payload)) {
    const nextValue = sanitizePayloadValue(value, key, options, seen);
    if (nextValue !== undefined) {
      sanitized[key] = nextValue;
    }
  }
  return sanitized;
}

function sanitizeAnalyticsEvent<
  TEventName extends string,
  TPayload extends AnalyticsPayload,
>(
  event: AnalyticsEvent<TEventName, TPayload>,
  options: SanitizeAnalyticsPayloadOptions,
): AnalyticsEvent<TEventName, TPayload> {
  return {
    ...event,
    eventPayload: sanitizeAnalyticsPayload(event.eventPayload, {
      maxPayloadBytes: options.maxPayloadBytes,
      redactKeys: options.redactKeys,
    }) as TPayload,
    sessionToken: event.sessionToken ? "[REDACTED]" : event.sessionToken,
  };
}

function sanitizePayloadValue(
  value: unknown,
  key: string | null,
  options: SanitizeAnalyticsPayloadOptions,
  seen: WeakSet<object>,
): AnalyticsPayloadValue | undefined {
  if (key && isSensitiveAnalyticsKey(key, options.redactKeys)) {
    return "[REDACTED]";
  }
  if (value === null) {
    return null;
  }
  if (typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return undefined;
    }
    seen.add(value);
    const items = value.map((item) => sanitizePayloadValue(item, null, options, seen) ?? null);
    seen.delete(value);
    return items;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (isRecord(value)) {
    if (seen.has(value)) {
      return undefined;
    }
    seen.add(value);
    const result: Record<string, AnalyticsPayloadValue> = {};
    for (const [nestedKey, nestedValue] of Object.entries(value)) {
      const sanitized = sanitizePayloadValue(nestedValue, nestedKey, options, seen);
      if (sanitized !== undefined) {
        result[nestedKey] = sanitized;
      }
    }
    seen.delete(value);
    return result;
  }
  return undefined;
}

function isSensitiveAnalyticsKey(key: string, redactKeys: readonly string[] | undefined): boolean {
  const normalized = normalizeRedactKey(key);
  const candidates = [...DEFAULT_REDACT_KEYS, ...(redactKeys ?? [])].map(normalizeRedactKey);
  return candidates.some((candidate) => {
    if (!candidate) {
      return false;
    }
    return normalized === candidate || normalized.includes(candidate);
  });
}

function normalizeRedactKey(value: string): string {
  return value.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function jsonByteLength(value: unknown): number {
  const text = JSON.stringify(value);
  if (typeof TextEncoder !== "undefined") {
    return new TextEncoder().encode(text).byteLength;
  }
  return utf8ByteLength(text);
}

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x7f) {
      bytes += 1;
    } else if (code <= 0x7ff) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isEnabled<T extends { enabled: true }>(config: T | false | undefined): config is T {
  return config !== false && config?.enabled === true;
}

function resolveSessionToken<
  TEventName extends string,
  TPayload extends AnalyticsPayload,
>(
  config: DetailAnalyticsConfig<TEventName, TPayload> | undefined,
): string | null {
  if (!isEnabled(config)) {
    return null;
  }
  return config.sessionTokenProvider?.() ?? null;
}

function resolveAppsInTossModule(
  moduleOrFactory: AppsInTossAnalyticsModule | null | (() => AppsInTossAnalyticsModule | null) | undefined,
) {
  if (typeof moduleOrFactory === "function") {
    return moduleOrFactory();
  }
  return moduleOrFactory ?? null;
}

function optionOrFallback(
  options: AnalyticsTrackOptions,
  key: "screen" | "sessionToken",
  fallback: string | null,
): string | null {
  if (Object.prototype.hasOwnProperty.call(options, key)) {
    return options[key] ?? null;
  }
  return fallback;
}

function isPromiseLike(value: unknown): value is Promise<void> {
  return (
    typeof value === "object" &&
    value != null &&
    "then" in value &&
    typeof (value as { then?: unknown }).then === "function"
  );
}
