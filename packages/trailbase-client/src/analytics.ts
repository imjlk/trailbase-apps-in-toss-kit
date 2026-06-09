export type AnalyticsPayloadValue =
  | string
  | number
  | boolean
  | null
  | undefined;

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
    const current = pending;
    pending = [];
    await Promise.allSettled(current);
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
              } as TPayload,
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

function isEnabled<T extends { enabled: true }>(config: T | false | undefined): config is T {
  return config !== false && config?.enabled === true;
}

function resolveSessionToken(config: DetailAnalyticsConfig): string | null {
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
