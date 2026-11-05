import type { Analytics as WebAnalytics, EventLogParams } from "@apps-in-toss/web-framework";
import {
  createAppsInTossAnalyticsConfig as createCoreConfig,
  configureAppsInTossAnalyticsRouterFromBootstrap as configureCoreRouter,
  sanitizeAnalyticsPayload,
  type AnalyticsPayload,
  type CreateAppsInTossAnalyticsConfigOptions as CoreOptions,
  type ConfigureAppsInTossAnalyticsRouterFromBootstrapOptions as CoreBootstrapOptions,
} from "@trailbase-apps-in-toss-kit/ait-core/analytics";
export * from "@trailbase-apps-in-toss-kit/ait-core/analytics";

export type AppsInTossAnalytics = typeof WebAnalytics;
export type AppsInTossAnalyticsModule = Pick<AppsInTossAnalytics, "log">;

export interface CreateAppsInTossWebAnalyticsConfigOptions<TEventName extends string = string, TPayload extends AnalyticsPayload = AnalyticsPayload>
  extends Omit<CoreOptions<TEventName, TPayload>, "analyticsModule" | "captureSdkLoggerToDetail"> {
  /** SDK 3 has Analytics.log, not RN's Analytics.init/logger interception. */
  analyticsModule?: Pick<typeof WebAnalytics, "log">;
}

export function createAppsInTossAnalyticsConfig<TEventName extends string = string, TPayload extends AnalyticsPayload = AnalyticsPayload>(
  { analyticsModule, dispatch, ...options }: CreateAppsInTossWebAnalyticsConfigOptions<TEventName, TPayload> = {},
) {
  return createCoreConfig<TEventName, TPayload>({
    ...options,
    dispatch: dispatch ?? (async event => {
      const analytics = analyticsModule ?? (await import("@apps-in-toss/web-framework")).Analytics;
      const params: EventLogParams["params"] = {};
      // SDK 3 accepts scalar params only; keep richer nested data in the detail sink.
      for (const [key, value] of Object.entries(sanitizeAnalyticsPayload(event.params ?? {}))) {
        if (value === null || ["string", "number", "boolean", "undefined"].includes(typeof value)) {
          params[key] = value as string | number | boolean | null | undefined;
        }
      }
      const logTypes = { press: "click", area: "event", custom: "event", screen: "screen", impression: "impression" } as const;
      await analytics.log({
        log_name: event.name,
        log_type: logTypes[event.type],
        params,
      });
    }),
  });
}

export function configureAppsInTossAnalyticsRouterFromBootstrap<TEventName extends string = string, TPayload extends AnalyticsPayload = AnalyticsPayload>(
  { appsInToss, ...options }: Omit<CoreBootstrapOptions<TEventName, TPayload>, "appsInToss"> & {
    appsInToss?: CreateAppsInTossWebAnalyticsConfigOptions<TEventName, TPayload>;
  },
) {
  const config = createAppsInTossAnalyticsConfig(appsInToss);
  return configureCoreRouter({ ...options, appsInToss: config || undefined });
}

export type CreateAppsInTossAnalyticsConfigOptions<TEventName extends string = string, TPayload extends AnalyticsPayload = AnalyticsPayload> = CreateAppsInTossWebAnalyticsConfigOptions<TEventName, TPayload>;
export type ConfigureAppsInTossAnalyticsRouterFromBootstrapOptions<TEventName extends string = string, TPayload extends AnalyticsPayload = AnalyticsPayload> =
  Omit<CoreBootstrapOptions<TEventName, TPayload>, "appsInToss"> & { appsInToss?: CreateAppsInTossWebAnalyticsConfigOptions<TEventName, TPayload> };
