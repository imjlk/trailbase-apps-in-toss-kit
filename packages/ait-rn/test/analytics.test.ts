import { describe, expect, test } from "bun:test";
import {
  configureAppsInTossAnalyticsRouterFromBootstrap,
  createAnalyticsRouter,
  createAppsInTossAnalyticsConfig,
  type AppsInTossAnalytics,
} from "../src/analytics";

describe("AppsInToss analytics helpers", () => {
  test("creates framework-typed AppsInToss analytics router config", () => {
    const initCalls: unknown[] = [];
    const analyticsModule: Pick<AppsInTossAnalytics, "init"> = {
      init: (options) => {
        initCalls.push(options);
      },
    };

    const config = createAppsInTossAnalyticsConfig({
      analyticsModule: analyticsModule as AppsInTossAnalytics,
      debug: true,
    });
    const router = createAnalyticsRouter({
      appsInToss: config,
    });

    router.track("screen_view");

    expect(initCalls).toHaveLength(1);
    expect(
      (initCalls[0] as { logger?: unknown; debug?: boolean }).debug,
    ).toBe(true);
  });

  test("configures bootstrap analytics with AppsInToss framework module typing", async () => {
    const posted: unknown[] = [];
    const dispatched: string[] = [];
    const initCalls: unknown[] = [];
    const analyticsModule: Pick<AppsInTossAnalytics, "init"> = {
      init: (options) => {
        initCalls.push(options);
      },
    };
    const router = createAnalyticsRouter<"screen_view" | "debug_event">();

    const policy = configureAppsInTossAnalyticsRouterFromBootstrap({
      router,
      policy: {
        enabled: true,
        trailbase: {
          enabled: true,
          flushIntervalMs: 0,
        },
        appsInToss: {
          enabled: true,
          allowedEvents: ["screen_view"],
        },
      },
      trailbase: {
        endpoint: "/api/analytics/events",
        fetcher: async (_url, init) => {
          posted.push(JSON.parse(init.body as string));
          return new Response(JSON.stringify({ ok: true }));
        },
      },
      appsInToss: {
        analyticsModule: analyticsModule as AppsInTossAnalytics,
        mapEvent: (event) => ({
          name: event.eventName,
          type: "custom",
          params: event.eventPayload,
        }),
        dispatch: (event) => {
          dispatched.push(event.name);
        },
      },
    });

    router.track("debug_event");
    router.track("screen_view", { section: "home" });
    await router.flush();

    expect(policy.trailbase).toMatchObject({
      enabled: true,
      endpoint: "/api/analytics/events",
    });
    expect(initCalls).toHaveLength(1);
    expect(dispatched).toEqual(["screen_view"]);
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({
      events: [
        {
          eventName: "debug_event",
        },
        {
          eventName: "screen_view",
          eventPayload: {
            section: "home",
          },
        },
      ],
    });
  });

  test("exports the analytics subpath", async () => {
    const module = await import(
      "@trailbase-apps-in-toss-kit/ait-rn/analytics"
    );

    expect(module.createAnalyticsRouter).toBeFunction();
    expect(module.createAppsInTossAnalyticsConfig).toBeFunction();
    expect(module.configureAppsInTossAnalyticsRouterFromBootstrap).toBeFunction();
  });
});
