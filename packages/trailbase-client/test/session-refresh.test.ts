import { expect, test, mock } from "bun:test";
import { createAppsInTossSessionManager, createTrailBaseTokenRefresher, TrailBaseHttpError, StaleAppSessionOperationError, trailBaseTokenExpiresAt, type AppsInTossSessionManagerOptions } from "../src/index";
const authError = () => new TrailBaseHttpError("expired", { status: 401, statusText: "Unauthorized", payload: null });
const tokens = { authToken: "old", refreshToken: "refresh", csrfToken: "csrf" };
const renewed = { authToken: "new", refreshToken: "rotated", csrfToken: "new-csrf" };
function setup(options: Partial<AppsInTossSessionManagerOptions<{ id: string }>> = {}) {
  const values = new Map<string, string>();
  const bootstrap = mock(async () => ({ authTokens: tokens, user: { id: "a" } }));
  const refreshAuthTokens = mock(async () => renewed);
  const loadSession = mock(async () => ({ user: { id: "a" }, rewards: { count: 2 } }));
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  const manager = createAppsInTossSessionManager({ storage, bootstrap, refreshAuthTokens, loadSession,
    appLogin: async () => ({ authorizationCode: "x", referrer: "DEFAULT" }),
    completeTossLogin: async () => ({ authTokens: renewed, user: { id: "b" } }), ...options });
  return { manager, values, bootstrap, refreshAuthTokens, loadSession };
}
test("revisit restores tokens and fresh data without password login or refresh", async () => {
  const s = setup();
  await s.manager.getOrCreateAppSession();
  const result = await s.manager.getOrCreateAppSession();
  expect(s.bootstrap).toHaveBeenCalledTimes(1);
  expect(s.refreshAuthTokens).not.toHaveBeenCalled();
  expect(result.authTokens).toEqual(tokens);
  expect(result.rewards).toEqual({ count: 2 });
});
test("concurrent renewal shares refresh, persists rotation, and revalidates data", async () => {
  const s = setup();
  await s.manager.getOrCreateAppSession();
  const [a, b] = await Promise.all([s.manager.renewAppSession(), s.manager.renewAppSession()]);
  expect(a.authTokens).toEqual(renewed);
  expect(b).toEqual(a);
  expect(s.refreshAuthTokens).toHaveBeenCalledTimes(1);
  expect(s.bootstrap).toHaveBeenCalledTimes(1);
  expect(JSON.parse(s.values.get("trailbase.appSession")!).authTokens).toEqual(renewed);
});
test("access rejection refreshes once and retries the data request", async () => {
  const seen: string[] = [];
  const s = setup({ loadSession: async input => {
    seen.push(input.authTokens!.authToken);
    if (input.authTokens!.authToken === "old") throw authError();
    return { user: { id: "a" } };
  } });
  await s.manager.getOrCreateAppSession();
  await s.manager.getOrCreateAppSession();
  expect(seen).toEqual(["old", "new"]);
  expect(s.bootstrap).toHaveBeenCalledTimes(1);
});
test("invalid refresh falls back to bootstrap; transient/forbidden failures preserve credentials", async () => {
  for (const status of [401, 403, 500]) {
    const s = setup({ refreshAuthTokens: async () => { throw new TrailBaseHttpError("failed", {status, statusText: "error", payload: null}); },
      isInvalidSessionError: e => e instanceof TrailBaseHttpError && e.status === 401 });
    await s.manager.getOrCreateAppSession();
    const before = s.values.get("trailbase.appSession");
    if (status === 401) {
      await s.manager.renewAppSession();
      expect(s.bootstrap).toHaveBeenCalledTimes(2);
    } else {
      await expect(s.manager.renewAppSession()).rejects.toThrow();
      expect(s.values.get("trailbase.appSession")).toBe(before);
      expect(s.bootstrap).toHaveBeenCalledTimes(1);
    }
  }
});
test("rotated credentials survive a following data outage", async () => {
  const s = setup({ loadSession: async () => { throw new Error("offline"); } });
  await s.manager.getOrCreateAppSession();
  await expect(s.manager.renewAppSession()).rejects.toThrow("offline");
  expect(JSON.parse(s.values.get("trailbase.appSession")!).authTokens).toEqual(renewed);
  expect(s.bootstrap).toHaveBeenCalledTimes(1);
});
test("late refresh cannot overwrite an adopted account", async () => {
  let finish!: (value: typeof renewed) => void;
  let started = false;
  const s = setup({ refreshAuthTokens: async () => { started = true; return new Promise(resolve => { finish = resolve; }); } });
  await s.manager.getOrCreateAppSession();
  const pending = s.manager.renewAppSession().catch(e => e);
  while (!started) await new Promise(resolve => setTimeout(resolve, 0));
  await s.manager.adoptAppSession({ authTokens: { ...renewed, authToken: "account-b" }, user: { id: "b" } }, "toss");
  finish(renewed);
  expect(await pending).toBeInstanceOf(StaleAppSessionOperationError);
  expect(JSON.parse(s.values.get("trailbase.appSession")!).authTokens.authToken).toBe("account-b");
});
test("storage read failures do not create another anonymous session", async () => {
  const s = setup({ storage: { getItem: () => { throw new Error("storage unavailable"); }, setItem: () => {} } });
  await expect(s.manager.getOrCreateAppSession()).rejects.toThrow("storage unavailable");
  expect(s.bootstrap).not.toHaveBeenCalled();
});
test("official refresh preserves omitted refresh token and accepts rotation", async () => {
  for (const rotated of [undefined, "rotated"]) {
    const refresh = createTrailBaseTokenRefresher({ baseUrl: "https://example.test", fetchImpl: (async (url, init) => {
      expect(url).toBe("https://example.test/api/auth/v1/refresh");
      expect(JSON.parse(init!.body as string)).toEqual({ refresh_token: "refresh" });
      expect(init!.signal).toBeInstanceOf(AbortSignal);
      return Response.json({ auth_token: "new", csrf_token: "new-csrf", ...(rotated ? {refresh_token: rotated} : {}) });
    }) as typeof fetch });
    expect((await refresh(tokens, { signal: new AbortController().signal })).refreshToken).toBe(rotated ?? "refresh");
  }
});
test("expiry scheduling supports seconds, milliseconds, and malformed tokens", () => {
  const jwt = (exp: number) => `header.${Buffer.from(JSON.stringify({exp})).toString("base64url")}.signature`;
  expect(trailBaseTokenExpiresAt(jwt(1800000000))).toBe(1800000000000);
  expect(trailBaseTokenExpiresAt(jwt(1800000000000))).toBe(1800000000000);
  expect(trailBaseTokenExpiresAt("opaque")).toBeNull();
});
test("expired access token refreshes before data request", async () => {
  const expired = { ...tokens, authToken: `h.${Buffer.from('{"exp":1}').toString("base64url")}.s` };
  const s = setup({ bootstrap: async () => ({authTokens: expired, user: {id: "a"}}) });
  await s.manager.getOrCreateAppSession();
  await s.manager.getOrCreateAppSession();
  expect(s.refreshAuthTokens).toHaveBeenCalledTimes(1);
  expect(s.loadSession.mock.calls[0]?.[0]?.authTokens).toEqual(renewed);
});
