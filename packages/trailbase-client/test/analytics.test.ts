import { describe, expect, test } from "bun:test";
import {
  AnalyticsSinkRequestError,
  configureAnalyticsRouterFromBootstrap,
  createAnalyticsRouter,
  createBufferedAnalyticsSink,
  createTrailBaseAnalyticsEventClient,
  normalizeAnalyticsBootstrapPolicy,
  sanitizeAnalyticsPayload,
  type AnalyticsEvent,
} from "../src/analytics";

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

  test("does not reinitialize AppsInToss analytics after config updates", () => {
    const initCalls: string[] = [];
    const dispatched: string[] = [];
    const router = createAnalyticsRouter<"screen_view">({
      appsInToss: {
        enabled: true,
        analyticsModule: {
          init: () => initCalls.push("init"),
        },
        mapEvent: (event) => ({
          name: event.eventName,
          type: "custom",
          params: event.eventPayload,
        }),
        dispatch: (event) => {
          dispatched.push(`first:${event.name}`);
        },
      },
    });

    router.configure({
      appsInToss: {
        enabled: true,
        analyticsModule: {
          init: () => initCalls.push("second-init"),
        },
        mapEvent: (event) => ({
          name: event.eventName,
          type: "custom",
          params: event.eventPayload,
        }),
        dispatch: (event) => {
          dispatched.push(`second:${event.name}`);
        },
      },
    });
    router.track("screen_view");

    expect(initCalls).toEqual(["init"]);
    expect(dispatched).toEqual(["second:screen_view"]);
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

  test("flush waits for detail sink flush callbacks", async () => {
    const calls: string[] = [];
    const router = createAnalyticsRouter<"screen_view">({
      detail: {
        enabled: true,
        enqueueBatch: (events) => {
          calls.push(`enqueue:${events[0]?.eventName}`);
        },
        flush: async () => {
          calls.push("flush");
        },
      },
    });

    router.track("screen_view");
    await router.flush();

    expect(calls).toEqual(["enqueue:screen_view", "flush"]);
  });

  test("normalizes missing and disabled bootstrap policy to disabled sinks", async () => {
    expect(normalizeAnalyticsBootstrapPolicy(undefined)).toMatchObject({
      enabled: false,
      trailbase: { enabled: false, endpoint: null },
      appsInToss: { enabled: false },
    });

    const fetchCalls: unknown[] = [];
    const debugCalls: string[] = [];
    const router = createAnalyticsRouter<"screen_view">({
      debug: {
        enabled: true,
        logger: (event) => {
          debugCalls.push(event.eventName);
        },
      },
    });
    configureAnalyticsRouterFromBootstrap({
      router,
      policy: { enabled: false, trailbase: { enabled: true, endpoint: "/api/events" } },
      trailbase: {
        fetcher: async (url, init) => {
          fetchCalls.push({ url, init });
          return jsonResponse({ ok: true });
        },
      },
    });

    router.track("screen_view");
    await router.flush();

    expect(fetchCalls).toEqual([]);
    expect(debugCalls).toEqual([]);
  });

  test("configures a TrailBase analytics sink from bootstrap and posts batches", async () => {
    const fetchCalls: Array<{ url: string; init: RequestInit }> = [];
    const router = createAnalyticsRouter<"screen_view" | "input_changed">();

    configureAnalyticsRouterFromBootstrap({
      router,
      policy: {
        enabled: true,
        trailbase: {
          enabled: true,
          endpoint: "/api/analytics/events",
          allowedEvents: ["screen_view"],
          flushIntervalMs: 0,
          maxBatchSize: 10,
        },
      },
      trailbase: {
        baseUrl: "https://app.example",
        fetcher: async (url, init) => {
          fetchCalls.push({ url, init });
          return jsonResponse({ ok: true });
        },
        getAuthHeaders: () => ({ Authorization: "Bearer session-token" }),
      },
      sessionTokenProvider: () => "session-token",
    });

    router.track("input_changed", { length: 3 });
    router.track("screen_view", { tossUserKey: "raw-user-key", section: "main" });
    await router.flush();

    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0]?.url).toBe("https://app.example/api/analytics/events");
    expect((fetchCalls[0]?.init.headers as Headers).get("Authorization")).toBe(
      "Bearer session-token",
    );
    const body = parseBody(fetchCalls[0]?.init);
    expect(body.events).toHaveLength(1);
    expect(body.events[0]).toMatchObject({
      eventName: "screen_view",
      eventPayload: {
        tossUserKey: "[REDACTED]",
        section: "main",
      },
      sessionToken: "[REDACTED]",
    });
  });

  test("honors option endpoint overrides when bootstrap enables TrailBase", async () => {
    const fetchCalls: Array<{ url: string; init: RequestInit }> = [];
    const router = createAnalyticsRouter<"screen_view">();

    const policy = configureAnalyticsRouterFromBootstrap({
      router,
      policy: {
        enabled: true,
        trailbase: {
          enabled: true,
          flushIntervalMs: 0,
        },
      },
      trailbase: {
        endpoint: "/api/override-analytics/events",
        fetcher: async (url, init) => {
          fetchCalls.push({ url, init });
          return jsonResponse({ ok: true });
        },
      },
    });

    router.track("screen_view");
    await router.flush();

    expect(policy.trailbase).toMatchObject({
      enabled: true,
      endpoint: "/api/override-analytics/events",
    });
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0]?.url).toBe("/api/override-analytics/events");
  });

  test("clears old buffered sinks when bootstrap disables analytics", async () => {
    const fetchCalls: unknown[] = [];
    const router = createAnalyticsRouter<"screen_view">();

    configureAnalyticsRouterFromBootstrap({
      router,
      policy: {
        enabled: true,
        trailbase: {
          enabled: true,
          endpoint: "/api/analytics/events",
          flushIntervalMs: 5,
        },
      },
      trailbase: {
        fetcher: async (url, init) => {
          fetchCalls.push({ url, init });
          return jsonResponse({ ok: true });
        },
      },
    });

    router.track("screen_view");
    configureAnalyticsRouterFromBootstrap({
      router,
      policy: { enabled: false },
    });
    await delay(20);
    await router.flush();

    expect(fetchCalls).toEqual([]);
  });

  test("does not retry cleared in-flight buffered sink failures", async () => {
    const attempts: string[] = [];
    let fail = true;
    const sink = createBufferedAnalyticsSink({
      enqueueBatch: async (events) => {
        attempts.push(events.map((event) => event.eventName).join(","));
        await delay(1);
        if (fail) {
          throw new Error("network down");
        }
      },
      flushIntervalMs: 0,
      maxBatchSize: 1,
    });

    const flushPromise = sink.enqueueBatch([createEvent("screen_view", {})], {
      sink: "detail",
    }) as Promise<void>;
    sink.clear();

    await expect(flushPromise).rejects.toThrow("network down");
    fail = false;
    await delay(5);
    await sink.flush();

    expect(attempts).toEqual(["screen_view"]);
    expect(sink.getQueueSize()).toBe(0);
  });

  test("leaves AppsInToss SDK wiring to the RN analytics helper", async () => {
    const dispatched: string[] = [];
    const router = createAnalyticsRouter<"screen_view" | "debug_event">({
      appsInToss: {
        enabled: true,
        mapEvent: (event) => ({
          name: event.eventName,
          type: "custom",
          params: event.eventPayload,
        }),
        dispatch: async (event) => {
          dispatched.push(event.name);
        },
      },
    });

    const policy = configureAnalyticsRouterFromBootstrap({
      router,
      policy: {
        enabled: true,
        appsInToss: {
          enabled: true,
          allowedEvents: ["screen_view"],
        },
      },
    });

    router.track("debug_event");
    router.track("screen_view");
    await router.flush();

    expect(policy.appsInToss).toMatchObject({
      enabled: true,
      allowedEvents: ["screen_view"],
    });
    expect(dispatched).toEqual([]);
  });

  test("TrailBase analytics client joins URLs, sends auth headers, and reports failures", async () => {
    const client = createTrailBaseAnalyticsEventClient({
      baseUrl: "https://app.example/",
      endpoint: "api/events",
      fetcher: async (url, init) => {
        expect(url).toBe("https://app.example/api/events");
        expect((init.headers as Headers).get("X-App-Session")).toBe("session");
        return jsonResponse({ message: "bad request" }, { status: 422, statusText: "Unprocessable" });
      },
      getAuthHeaders: async () => [["X-App-Session", "session"]],
    });

    await expect(
      client.enqueueBatch([
        createEvent("screen_view", { source: "test" }),
      ]),
    ).rejects.toMatchObject({
      name: "AnalyticsSinkRequestError",
      status: 422,
      message: "bad request",
    } satisfies Partial<AnalyticsSinkRequestError>);
  });

  test("TrailBase analytics client surfaces fetch failures", async () => {
    const client = createTrailBaseAnalyticsEventClient({
      endpoint: "/api/events",
      fetcher: async () => {
        throw new Error("network down");
      },
    });

    await expect(
      client.enqueueBatch([createEvent("screen_view", {})]),
    ).rejects.toThrow("network down");
  });

  test("buffered sink samples, batches, and flushes pending events", async () => {
    const batches: string[][] = [];
    const sink = createBufferedAnalyticsSink({
      enqueueBatch: async (events) => {
        batches.push(events.map((event) => event.eventName));
      },
      maxBatchSize: 2,
      flushIntervalMs: 0,
      sampleRate: 0.5,
      random: (() => {
        const values = [0.1, 0.75, 0.2];
        return () => values.shift() ?? 0;
      })(),
    });

    await sink.enqueueBatch([
      createEvent("first", {}),
      createEvent("sampled_out", {}),
    ], { sink: "detail" });
    expect(sink.getQueueSize()).toBe(1);

    await sink.enqueueBatch([createEvent("second", {})], { sink: "detail" });
    expect(batches).toEqual([["first", "second"]]);
    expect(sink.getQueueSize()).toBe(0);
  });

  test("buffered sink caps queues and supports explicit clear", async () => {
    const sink = createBufferedAnalyticsSink({
      enqueueBatch: async () => {},
      maxBatchSize: 10,
      maxQueueSize: 2,
      flushIntervalMs: 0,
    });

    sink.enqueueBatch([
      createEvent("first", {}),
      createEvent("second", {}),
      createEvent("third", {}),
    ], { sink: "detail" });

    expect(sink.getQueueSize()).toBe(2);
    sink.clear();
    expect(sink.getQueueSize()).toBe(0);
  });

  test("sanitizes sensitive keys, unsupported values, and oversized payloads", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(
      sanitizeAnalyticsPayload({
        authToken: "secret-token",
        nested: {
          toss_user_key: "raw-user-key",
          ok: true,
        },
        count: Number.POSITIVE_INFINITY,
        callback: () => undefined,
        circular,
      }),
    ).toEqual({
      authToken: "[REDACTED]",
      nested: {
        toss_user_key: "[REDACTED]",
        ok: true,
      },
      circular: {},
    });

    expect(
      sanitizeAnalyticsPayload({ text: "x".repeat(100) }, { maxPayloadBytes: 20 }),
    ).toMatchObject({
      analyticsPayloadTruncated: true,
      analyticsPayloadBytes: expect.any(Number),
    });
  });
});

function createEvent(
  eventName: string,
  eventPayload: Record<string, unknown>,
): AnalyticsEvent<string> {
  return {
    eventName,
    eventPayload: eventPayload as AnalyticsEvent<string>["eventPayload"],
    clientCreatedAt: 1,
  };
}

function jsonResponse(
  body: unknown,
  init: ResponseInit = {},
): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    statusText: init.statusText,
    headers: {
      "Content-Type": "application/json",
      ...Object.fromEntries(new Headers(init.headers).entries()),
    },
  });
}

function parseBody(init: RequestInit | undefined): { events: unknown[] } {
  expect(typeof init?.body).toBe("string");
  return JSON.parse(init?.body as string);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
