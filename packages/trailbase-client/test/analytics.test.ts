import { describe, expect, test } from "bun:test";
import { createAnalyticsRouter, type AnalyticsEvent } from "../src/analytics";

describe("analytics router", () => {
  test("defaults to disabled sinks", async () => {
    const router = createAnalyticsRouter<"screen_view">();

    router.track("screen_view", { source: "test" });

    await expect(router.flush()).resolves.toBeUndefined();
  });

  test("routes detail events with session and screen context", async () => {
    const events: Array<AnalyticsEvent<"round_impression">> = [];
    const router = createAnalyticsRouter<"round_impression">({
      screen: "main",
      detail: {
        enabled: true,
        sessionTokenProvider: () => "session-token",
        enqueueBatch: (batch) => {
          events.push(...batch);
        },
      },
    });

    router.track("round_impression", { roundNo: 10 });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      eventName: "round_impression",
      eventPayload: { roundNo: 10 },
      screen: "main",
      sessionToken: "session-token",
    });
  });

  test("respects explicit null track context overrides", () => {
    const events: Array<AnalyticsEvent<"screen_view">> = [];
    const router = createAnalyticsRouter<"screen_view">({
      screen: "main",
      detail: {
        enabled: true,
        sessionTokenProvider: () => "session-token",
        enqueueBatch: (batch) => {
          events.push(...batch);
        },
      },
    });

    router.track("screen_view", {}, { screen: null, sessionToken: null });

    expect(events[0]).toMatchObject({
      eventName: "screen_view",
      screen: null,
      sessionToken: null,
    });
  });

  test("initializes AppsInToss analytics and mirrors SDK logger events to detail", () => {
    const initCalls: unknown[] = [];
    const events: Array<AnalyticsEvent<string>> = [];
    const router = createAnalyticsRouter({
      detail: {
        enabled: true,
        enqueueBatch: (batch) => {
          events.push(...batch);
        },
      },
      appsInToss: {
        enabled: true,
        analyticsModule: {
          init: (options) => initCalls.push(options),
        },
      },
    });

    const logger = (initCalls[0] as { logger?: (params: unknown) => void })?.logger;
    expect(logger).toEqual(expect.any(Function));

    logger?.({
      log_name: "SDK Press",
      log_type: "press",
      params: { button: "answer_submit" },
    });
    router.track("screen_view", { source: "test" });

    expect(events.map((event) => event.eventName)).toEqual([
      "SDK Press",
      "screen_view",
    ]);
    expect(events[0]?.eventPayload).toMatchObject({
      button: "answer_submit",
      appsInTossLogType: "press",
    });
  });

  test("retries AppsInToss initialization when the module becomes available later", () => {
    const initCalls: unknown[] = [];
    let module = null as null | { init: (options: unknown) => void };
    const router = createAnalyticsRouter({
      appsInToss: {
        enabled: true,
        analyticsModule: () => module,
      },
    });

    router.track("screen_view", { source: "before-module" });
    module = {
      init: (options) => initCalls.push(options),
    };
    router.configure({});

    expect(initCalls).toHaveLength(1);
  });

  test("retries AppsInToss initialization after init throws", () => {
    const errors: string[] = [];
    const initCalls: string[] = [];
    let shouldThrow = true;
    const router = createAnalyticsRouter({
      appsInToss: {
        enabled: true,
        analyticsModule: {
          init: () => {
            initCalls.push("init");
            if (shouldThrow) {
              throw new Error("init boom");
            }
          },
        },
      },
      onError: (error, context) => {
        errors.push(`${context.sink}:${String((error as Error).message)}`);
      },
    });

    shouldThrow = false;
    router.configure({});

    expect(initCalls).toEqual(["init", "init"]);
    expect(errors).toEqual(["appsInToss:init boom"]);
  });

  test("dispatches mapped AppsInToss events only when a mapper includes them", async () => {
    const dispatched: string[] = [];
    const router = createAnalyticsRouter<"answer_submit_tapped" | "answer_input_changed">({
      appsInToss: {
        enabled: true,
        mapEvent: (event) => {
          if (event.eventName !== "answer_submit_tapped") {
            return false;
          }
          return {
            name: "answer_submit",
            type: "press",
            params: event.eventPayload,
          };
        },
        dispatch: async (event) => {
          dispatched.push(`${event.type}:${event.name}`);
        },
      },
    });

    router.track("answer_input_changed", { length: 1 });
    router.track("answer_submit_tapped", { roundNo: 1 });
    await router.flush();

    expect(dispatched).toEqual(["press:answer_submit"]);
  });

  test("reports async sink errors without throwing from track", async () => {
    const errors: string[] = [];
    const router = createAnalyticsRouter<"screen_view">({
      detail: {
        enabled: true,
        enqueueBatch: async () => {
          throw new Error("network down");
        },
      },
      onError: (error, context) => {
        errors.push(`${context.sink}:${String((error as Error).message)}`);
      },
    });

    router.track("screen_view");
    await router.flush();

    expect(errors).toEqual(["detail:network down"]);
  });

  test("reports sync sink errors without throwing from track", async () => {
    const errors: string[] = [];
    const router = createAnalyticsRouter<"screen_view">({
      detail: {
        enabled: true,
        enqueueBatch: () => {
          throw new Error("sync boom");
        },
      },
      onError: (error, context) => {
        errors.push(`${context.sink}:${String((error as Error).message)}`);
      },
    });

    expect(() => router.track("screen_view")).not.toThrow();
    await router.flush();

    expect(errors).toEqual(["detail:sync boom"]);
  });
});
