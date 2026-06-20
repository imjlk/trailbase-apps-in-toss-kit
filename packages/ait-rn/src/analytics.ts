import {
  configureAnalyticsRouterFromBootstrap,
  type AnalyticsEvent,
  type AnalyticsPayload,
  type AnalyticsRouter,
  type AppsInTossAnalyticsConfig as TrailBaseAppsInTossAnalyticsConfig,
  type AppsInTossAnalyticsModule as TrailBaseAppsInTossAnalyticsModule,
  type ConfigureAnalyticsRouterFromBootstrapOptions,
  type NormalizedAnalyticsBootstrapPolicy,
} from "@trailbase-apps-in-toss-kit/trailbase-client/analytics";
import type { AppsInTossAnalytics } from "./internal/framework";

export {
  AnalyticsSinkRequestError,
  DEFAULT_ANALYTICS_FLUSH_INTERVAL_MS,
  DEFAULT_ANALYTICS_MAX_BATCH_SIZE,
  DEFAULT_ANALYTICS_MAX_PAYLOAD_BYTES,
  DEFAULT_ANALYTICS_MAX_QUEUE_SIZE,
  DEFAULT_ANALYTICS_SAMPLE_RATE,
  createAnalyticsRouter,
  createBufferedAnalyticsSink,
  createTrailBaseAnalyticsEventClient,
  normalizeAnalyticsBootstrapPolicy,
  sanitizeAnalyticsPayload,
} from "@trailbase-apps-in-toss-kit/trailbase-client/analytics";

export type {
  AnalyticsBootstrapPolicy,
  AnalyticsEvent,
  AnalyticsFetcher,
  AnalyticsHeaders,
  AnalyticsPayload,
  AnalyticsPayloadValue,
  AnalyticsRouter,
  AnalyticsRouterConfig,
  AnalyticsSinkContext,
  AnalyticsSinkResult,
  AnalyticsTrackOptions,
  AppsInTossAnalyticsBootstrapPolicy,
  AppsInTossLoggerParams,
  AppsInTossMappedEvent,
  BufferedAnalyticsSink,
  BufferedAnalyticsSinkOptions,
  DebugAnalyticsConfig,
  DetailAnalyticsConfig,
  NormalizedAnalyticsBootstrapPolicy,
  NormalizedAppsInTossAnalyticsBootstrapPolicy,
  NormalizedTrailBaseAnalyticsBootstrapPolicy,
  SanitizeAnalyticsPayloadOptions,
  TrailBaseAnalyticsBootstrapPolicy,
  TrailBaseAnalyticsEventClient,
  TrailBaseAnalyticsEventClientOptions,
} from "@trailbase-apps-in-toss-kit/trailbase-client/analytics";
export type { AppsInTossAnalytics } from "./internal/framework";

export type AppsInTossAnalyticsModule =
  | AppsInTossAnalytics
  | null
  | (() => AppsInTossAnalytics | null);

export interface CreateAppsInTossAnalyticsConfigOptions<
  TEventName extends string = string,
  TPayload extends AnalyticsPayload = AnalyticsPayload,
> extends Omit<
    Extract<
      TrailBaseAppsInTossAnalyticsConfig<TEventName, TPayload>,
      { enabled: true }
    >,
    "analyticsModule" | "enabled"
  > {
  analyticsModule?: AppsInTossAnalyticsModule;
}

export type AppsInTossAnalyticsConfig<
  TEventName extends string = string,
  TPayload extends AnalyticsPayload = AnalyticsPayload,
> = TrailBaseAppsInTossAnalyticsConfig<TEventName, TPayload>;

export interface ConfigureAppsInTossAnalyticsRouterFromBootstrapOptions<
  TEventName extends string = string,
  TPayload extends AnalyticsPayload = AnalyticsPayload,
> extends Omit<
    ConfigureAnalyticsRouterFromBootstrapOptions<TEventName, TPayload>,
    "appsInToss" | "router"
  > {
  appsInToss?: CreateAppsInTossAnalyticsConfigOptions<TEventName, TPayload>;
  router: AnalyticsRouter<TEventName, TPayload>;
}

export function createAppsInTossAnalyticsConfig<
  TEventName extends string = string,
  TPayload extends AnalyticsPayload = AnalyticsPayload,
>({
  analyticsModule,
  ...options
}: CreateAppsInTossAnalyticsConfigOptions<TEventName, TPayload> = {}): TrailBaseAppsInTossAnalyticsConfig<TEventName, TPayload> {
  return {
    ...options,
    analyticsModule:
      analyticsModule as unknown as TrailBaseAppsInTossAnalyticsModule,
    enabled: true,
  };
}

export function configureAppsInTossAnalyticsRouterFromBootstrap<
  TEventName extends string = string,
  TPayload extends AnalyticsPayload = AnalyticsPayload,
>({
  appsInToss,
  ...options
}: ConfigureAppsInTossAnalyticsRouterFromBootstrapOptions<TEventName, TPayload>): NormalizedAnalyticsBootstrapPolicy {
  const policy = configureAnalyticsRouterFromBootstrap(options);

  if (!policy.enabled || !policy.appsInToss.enabled) {
    return policy;
  }

  const allowedEvents = toAllowedEventsSet(policy.appsInToss.allowedEvents);
  const mapEvent = appsInToss?.mapEvent;
  options.router.configure({
    appsInToss: createAppsInTossAnalyticsConfig({
      ...appsInToss,
      mapEvent: mapEvent
        ? (event) => {
            if (!isAllowedEvent(event, allowedEvents)) {
              return false;
            }
            return mapEvent(event);
          }
        : undefined,
    }),
  });
  return policy;
}

function toAllowedEventsSet(value: readonly string[] | undefined): Set<string> | null {
  if (value === undefined) {
    return null;
  }
  return new Set(value);
}

function isAllowedEvent(
  event: AnalyticsEvent<string, AnalyticsPayload>,
  allowedEvents: Set<string> | null,
): boolean {
  return allowedEvents === null || allowedEvents.has(event.eventName);
}
