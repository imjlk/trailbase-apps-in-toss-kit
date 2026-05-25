import { describe, expect, test } from "bun:test";
import {
  TrailBaseHttpError,
  createAppsInTossSessionManager,
  createAnonymousHash,
  createSseParser,
  createTrailBaseAuthHeaders,
  createTrailBaseClientAuthOptions,
  normalizeTrailBaseUrl,
  normalizeAppsInTossErrorMessage,
  normalizeAppsInTossLoginResult,
  normalizeTrailBaseAuthTokens,
  requestAppsInTossLogin,
  requestJson,
  resolveAnonymousHash,
  toTrailBaseSdkTokens,
} from "../src/index";

describe("TrailBase client utilities", () => {
  test("normalizes base URLs", () => {
    expect(normalizeTrailBaseUrl("https://example.com///")).toBe("https://example.com");
  });

  test("requests JSON and normalizes errors", async () => {
    await expect(
      requestJson("https://example.invalid/test", {
        fetchImpl: async () =>
          new Response(JSON.stringify({ error: { message: "nope" } }), {
            status: 400,
            statusText: "Bad Request",
          }),
      }),
    ).rejects.toThrow(TrailBaseHttpError);
  });

  test("stringifies JSON-like request bodies", async () => {
    let capturedBody;
    let capturedHeaders;
    const response = await requestJson<{ ok: boolean }>("https://example.invalid/test", {
      method: "POST",
      body: { hello: "world" },
      fetchImpl: async (_url, init) => {
        capturedBody = init?.body;
        capturedHeaders = init?.headers;
        return new Response(JSON.stringify({ ok: true }));
      },
    });

    expect(response).toEqual({ ok: true });
    expect(capturedBody).toBe(JSON.stringify({ hello: "world" }));
    expect(new Headers(capturedHeaders).get("content-type")).toBe("application/json");
  });

  test("leaves native request bodies alone", async () => {
    const body = new URLSearchParams({ hello: "world" });
    let capturedBody;
    let capturedHeaders;
    await requestJson("https://example.invalid/test", {
      method: "POST",
      body,
      fetchImpl: async (_url, init) => {
        capturedBody = init?.body;
        capturedHeaders = init?.headers;
        return new Response(JSON.stringify({ ok: true }));
      },
    });

    expect(capturedBody).toBe(body);
    expect(new Headers(capturedHeaders).get("content-type")).toBeNull();
  });

  test("parses SSE data frames", () => {
    const events = [];
    const parser = createSseParser((event) => events.push(event));
    parser.push("event: insert\ndata: {\"id\":1}\n\n");

    expect(events).toEqual([{ event: "insert", data: "{\"id\":1}", id: undefined, retry: undefined }]);
  });

  test("resolves anonymous hash through storage", async () => {
    const storage = new Map();
    const hash = await resolveAnonymousHash({
      storage: {
        getItem: (key) => storage.get(key) ?? null,
        setItem: (key, value) => storage.set(key, value),
      },
      create: () => "anon_test",
    });

    expect(hash).toBe("anon_test");
    expect(await resolveAnonymousHash({ storage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
    } })).toBe("anon_test");
  });

  test("creates random-looking anonymous hashes", () => {
    expect(createAnonymousHash({ prefix: "user" })).toMatch(/^user_[0-9a-f]{32}$/);
  });

  test("normalizes Apps in Toss login result shapes", () => {
    expect(
      normalizeAppsInTossLoginResult({
        authorizationCode: "code-1",
        referrer: "DEFAULT",
      }),
    ).toEqual({ authorizationCode: "code-1", referrer: "DEFAULT" });
    expect(
      normalizeAppsInTossLoginResult({
        authorization_code: "code-2",
        referrer: "sandbox",
      }),
    ).toEqual({ authorizationCode: "code-2", referrer: "SANDBOX" });
  });

  test("normalizes TrailBase auth tokens and builds Record API headers", () => {
    const tokens = normalizeTrailBaseAuthTokens({
      auth_token: "auth",
      refresh_token: "refresh",
      csrf_token: "csrf",
    });

    expect(tokens).toEqual({
      authToken: "auth",
      refreshToken: "refresh",
      csrfToken: "csrf",
    });
    expect(createTrailBaseAuthHeaders(tokens)).toEqual({
      Authorization: "Bearer auth",
      "Refresh-Token": "refresh",
      "CSRF-Token": "csrf",
    });
    expect(toTrailBaseSdkTokens(tokens)).toEqual({
      auth_token: "auth",
      refresh_token: "refresh",
      csrf_token: "csrf",
    });
    expect(createTrailBaseClientAuthOptions(tokens)).toEqual({
      tokens: {
        auth_token: "auth",
        refresh_token: "refresh",
        csrf_token: "csrf",
      },
    });
    expect(createTrailBaseAuthHeaders({ auth_token: "sdk-auth" })).toEqual({
      Authorization: "Bearer sdk-auth",
    });
    expect(createTrailBaseAuthHeaders(null)).toEqual({});
  });

  test("normalizes Apps in Toss SDK and bridge errors for display", () => {
    expect(normalizeAppsInTossErrorMessage({ error: { message: "브릿지 오류" } })).toBe(
      "브릿지 오류",
    );
    expect(normalizeAppsInTossErrorMessage({ message: "[object Object]" }, "다시 시도해 주세요.")).toBe(
      "다시 시도해 주세요.",
    );
    expect(normalizeAppsInTossErrorMessage(undefined, "다시 시도해 주세요.")).toBe(
      "다시 시도해 주세요.",
    );
    expect(normalizeAppsInTossErrorMessage(new Error("TrailBase request failed"))).not.toContain(
      "TrailBase",
    );
  });

  test("preflight failure becomes a user-facing login message", async () => {
    await expect(
      requestAppsInTossLogin({
        appLogin: async () => ({ authorizationCode: "code", referrer: "DEFAULT" }),
        getIsTossLoginIntegratedService: async () => false,
      }),
    ).rejects.toThrow("토스 로그인이 아직 준비되지 않았어요.");
  });

  test("session manager signs in with injected bridges and backend callbacks", async () => {
    const storage = new Map<string, string>();
    const manager = createAppsInTossSessionManager({
      storage: {
        getItem: (key) => storage.get(key) ?? null,
        setItem: (key, value) => storage.set(key, value),
      },
      createAnonymousHash: () => "anon_1",
      appLogin: async () => ({ authorization_code: "code-1", referrer: "SANDBOX" }),
      loadSession: async ({ sessionToken }) => ({
        sessionToken,
        user: { id: "user-1" },
      }),
      bootstrap: async () => ({
        sessionToken: "anonymous-session",
        user: { id: "anonymous" },
      }),
      completeTossLogin: async (input) => ({
        sessionToken: `toss-session:${input.authorizationCode}:${input.referrer}`,
        user: { id: "user-1" },
      }),
    });

    const response = await manager.signInWithToss();
    expect(response).toEqual({
      authProvider: "toss",
      sessionToken: "toss-session:code-1:SANDBOX",
      user: { id: "user-1" },
    });
    expect(storage.get("trailbase.anonymousHash")).toBe("anon_1");
  });

  test("session manager stores TrailBase auth tokens for Record API access", async () => {
    const storage = new Map<string, string>();
    const manager = createAppsInTossSessionManager({
      storage: {
        getItem: (key) => storage.get(key) ?? null,
        setItem: (key, value) => storage.set(key, value),
      },
      createAnonymousHash: () => "anon_2",
      appLogin: async () => ({ authorizationCode: "code-2", referrer: "DEFAULT" }),
      loadSession: async ({ authTokens }) => ({
        authToken: authTokens?.authToken ?? "loaded-auth",
        refreshToken: authTokens?.refreshToken ?? "loaded-refresh",
        csrfToken: authTokens?.csrfToken ?? "loaded-csrf",
        user: { id: "loaded" },
      }),
      bootstrap: async () => ({
        auth_token: "anonymous-auth",
        refresh_token: "anonymous-refresh",
        csrf_token: "anonymous-csrf",
        user: { id: "anonymous" },
      }),
      completeTossLogin: async () => ({
        authToken: "toss-auth",
        refreshToken: "toss-refresh",
        csrfToken: "toss-csrf",
        user: { id: "user-2" },
      }),
    });

    const anonymous = await manager.getOrCreateAppSession();
    expect(anonymous.authTokens).toEqual({
      authToken: "anonymous-auth",
      refreshToken: "anonymous-refresh",
      csrfToken: "anonymous-csrf",
    });

    const restored = await manager.restoreStoredAppSession();
    expect(restored?.authTokens?.authToken).toBe("anonymous-auth");

    const toss = await manager.signInWithToss();
    expect(toss.authTokens).toEqual({
      authToken: "toss-auth",
      refreshToken: "toss-refresh",
      csrfToken: "toss-csrf",
    });
    expect(JSON.parse(storage.get("trailbase.tossSession") ?? "{}").authTokens.authToken).toBe(
      "toss-auth",
    );
  });
});
