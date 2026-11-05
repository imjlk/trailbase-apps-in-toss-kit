import { expect, test } from "bun:test";
import { configureAppsInTossAnalyticsRouterFromBootstrap, createAnalyticsRouter, createAppsInTossAnalyticsConfig } from "../src/analytics";

test("Web SDK logging preserves experiment dimensions and obeys the server collection switch", async () => {
  const logged: unknown[] = [];
  const posted: unknown[] = [];
  const router = createAnalyticsRouter();
  const configure = (enabled: boolean) => configureAppsInTossAnalyticsRouterFromBootstrap({
    router,
    policy: { enabled, trailbase: { enabled: true, flushIntervalMs: 0 }, appsInToss: { enabled: true, allowedEvents: ["ad_skip_used"] } },
    trailbase: { endpoint: "/api/analytics/events", fetcher: async (_url, init) => {
      posted.push(JSON.parse(init.body as string)); return new Response("{}");
    } },
    appsInToss: { analyticsModule: { log: async params => { logged.push(params); } },
      mapEvent: event => ({ name: event.eventName, type: "press", params: event.eventPayload }),
    },
  });
  configure(true);
  router.track("ad_skip_used", { experiment_id: "fixture-v4", variant: "control", userKey: "must-be-redacted" });
  router.track("not_allowed");
  await router.flush();
  expect(logged).toEqual([{ log_name: "ad_skip_used", log_type: "click", params: { experiment_id: "fixture-v4", variant: "control", userKey: "[REDACTED]" } }]);
  expect(JSON.stringify(posted)).not.toContain("must-be-redacted");
  expect(JSON.stringify(posted)).toContain('"variant":"control"');
  configure(false);
  const requests = posted.length;
  router.track("ad_skip_used", { variant: "short" });
  await router.flush();
  expect(logged).toHaveLength(1);
  expect(posted).toHaveLength(requests);
});

test("SDK log failure reports to the error handler while detail collection still completes", async () => {
  const errors: unknown[] = [];
  const detail: unknown[] = [];
  const router = createAnalyticsRouter({
    onError: error => { errors.push(error); },
    detail: { enabled: true, enqueueBatch: events => { detail.push(...events); } },
    appsInToss: createAppsInTossAnalyticsConfig({
      analyticsModule: { log: async () => { throw new Error("fixture SDK unavailable"); } },
      mapEvent: event => ({ name: event.eventName, type: "custom" }),
    }),
  });
  router.track("ad_completed", { variant: "short" });
  await router.flush();
  expect(detail).toHaveLength(1);
  expect(errors).toHaveLength(1);
});
