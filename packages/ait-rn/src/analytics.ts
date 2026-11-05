import {
  createAppsInTossAnalyticsConfig as createCoreConfig,
  configureAppsInTossAnalyticsRouterFromBootstrap as configureCoreRouter,
  type AnalyticsPayload,
  type AnalyticsRouter,
  type AppsInTossAnalyticsConfig as TrailBaseAppsInTossAnalyticsConfig,
  type AppsInTossAnalytics as TrailBaseAppsInTossAnalyticsModule,
  type ConfigureAnalyticsRouterFromBootstrapOptions,
  type NormalizedAnalyticsBootstrapPolicy,
} from "@trailbase-apps-in-toss-kit/ait-core/analytics";
import type { AppsInTossAnalytics } from "./internal/framework";

export {
  AnalyticsSinkRequestError,
  DEFAULT_ANALYTICS_FLUSH_INTERVAL_MS,
  DEFAULT_ANALYTICS_MAX_BATCH_SIZE,
  DEFAULT_ANALYTICS_MAX_PAYLOAD_BYTES,
  DEFAULT_ANALYTICS_MAX_QUEUE_SIZE,
  DEFAULT_ANALYTICS_SAMPLE_RATE,
  configureAnalyticsRouterFromBootstrap,
  createAnalyticsRouter,
  createBufferedAnalyticsSink,
  createTrailBaseAnalyticsEventClient,
  normalizeAnalyticsBootstrapPolicy,
  sanitizeAnalyticsPayload,
} from "./internal/analytics-core";

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
} from "./internal/analytics-core";
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
  return createCoreConfig({
    ...options,
    analyticsModule:
      analyticsModule as unknown as TrailBaseAppsInTossAnalyticsModule,
  });
}

export function configureAppsInTossAnalyticsRouterFromBootstrap<
  TEventName extends string = string,
  TPayload extends AnalyticsPayload = AnalyticsPayload,
>({
  appsInToss,
  ...options
}: ConfigureAppsInTossAnalyticsRouterFromBootstrapOptions<TEventName, TPayload>): NormalizedAnalyticsBootstrapPolicy {
  const config = appsInToss ? createAppsInTossAnalyticsConfig(appsInToss) : undefined;
  return configureCoreRouter({ ...options, appsInToss: config || undefined });
}
