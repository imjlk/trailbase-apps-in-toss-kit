import { expect, test, mock } from "bun:test";
import { createAppsInTossSessionManager, createTrailBaseTokenRefresher, TrailBaseHttpError, StaleAppSessionOperationError, trailBaseTokenExpiresAt, type AppsInTossSessionManagerOptions } from "../src/index";
const authError = () => new TrailBaseHttpError("expired", { status: 401, statusText: "Unauthorized", payload: null });
const tokens = { authToken: "old", refreshToken: "refresh", csrfToken: "csrf" };
const renewed = { authToken: "new", refreshToken: "rotated", csrfToken: "new-csrf" };
function setup(options: Partial<AppsInTossSessionManagerOptions<{ id: string }>> = {}) {
  const values = new Map<string, string>();
  const bootstrap = mock(async () => ({ authTokens: tokens, sessionToken: tokens.authToken, user: { id: "a" } }));
  const refreshAuthTokens = mock(async () => renewed);
  const loadSession = mock(async () => ({ user: { id: "a" }, rewards: { count: 2 } }));
  const writes = mock((key: string, value: string) => { values.set(key, value); });
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: writes };
  const manager = createAppsInTossSessionManager({ storage, bootstrap, refreshAuthTokens, loadSession,
    appLogin: async () => ({ authorizationCode: "x", referrer: "DEFAULT" }),
    completeTossLogin: async () => ({ authTokens: renewed, user: { id: "b" } }), ...options });
  return { manager, values, bootstrap, refreshAuthTokens, loadSession, writes };
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
test("default refresh classification preserves a disabled/forbidden account", async () => {
  const s = setup({loadSession: async () => {throw new TrailBaseHttpError("disabled", {status:403,statusText:"Forbidden",payload:null});}});
  await s.manager.getOrCreateAppSession();
  const before=s.values.get("trailbase.appSession");
  await expect(s.manager.getOrCreateAppSession()).rejects.toThrow("disabled");
  expect(s.values.get("trailbase.appSession")).toBe(before);
  expect(s.refreshAuthTokens).not.toHaveBeenCalled();
  expect(s.bootstrap).toHaveBeenCalledTimes(1);
});
test("forced renewal queued behind restoration still refreshes only once", async () => {
  const s=setup();
  await s.manager.getOrCreateAppSession();
  await Promise.all([s.manager.getOrCreateAppSession(), s.manager.renewAppSession(), s.manager.renewAppSession()]);
  expect(s.refreshAuthTokens).toHaveBeenCalledTimes(1);
});
test("queued renewal cannot run after disconnect supersedes restoration", async () => {
  let finish!: () => void;
  let started=false;
  const s=setup({loadSession: async()=>{started=true;await new Promise<void>(resolve=>{finish=resolve;});return {user:{id:"a"}};}});
  await s.manager.getOrCreateAppSession();
  const restore=s.manager.getOrCreateAppSession().catch(e=>e);
  while(!started) await new Promise(resolve=>setTimeout(resolve,0));
  const renewal=s.manager.renewAppSession().catch(e=>e);
  await s.manager.clearSessions();
  finish();
  expect(await restore).toBeInstanceOf(StaleAppSessionOperationError);
  expect(await renewal).toBeInstanceOf(StaleAppSessionOperationError);
  expect(s.refreshAuthTokens).not.toHaveBeenCalled();
  expect(s.values.get("trailbase.appSession")).toBe("");
});

test("unchanged restored credentials avoid native writes while returning fresh data", async () => {
  const s = setup();
  await s.manager.getOrCreateAppSession();
  s.writes.mockClear();
  expect((await s.manager.getOrCreateAppSession()).rewards).toEqual({count:2});
  expect(s.writes).not.toHaveBeenCalled();
  await s.manager.renewAppSession();
  // One marker/write/marker sequence for rotation, no duplicate write after state loading.
  expect(s.writes).toHaveBeenCalledTimes(3);
});
test("changed user data is persisted even when credentials are unchanged", async () => {
  const s = setup({loadSession: async () => ({user:{id:"a",name:"updated"}})});
  await s.manager.getOrCreateAppSession();
  s.writes.mockClear();
  await s.manager.getOrCreateAppSession();
  expect(s.writes).toHaveBeenCalledTimes(3);
  expect(JSON.parse(s.values.get("trailbase.appSession")!).user.name).toBe("updated");
});

test("Toss restore repairs the app mirror after an explicit anonymous bootstrap", async () => {
  const s = setup();
  await s.manager.adoptAppSession({authTokens:renewed,sessionToken:renewed.authToken,user:{id:"a"}}, "toss");
  await s.manager.bootstrapAnonymousSession();
  expect(JSON.parse(s.values.get("trailbase.appSession")!).authProvider).toBe("anonymous");
  await s.manager.restoreStoredTossSession();
  expect(s.values.get("trailbase.appSession")).toBe(s.values.get("trailbase.tossSession"));
  expect(JSON.parse(s.values.get("trailbase.appSession")!).authTokens).toEqual(renewed);
});
test("app restore repairs the Toss mirror after Toss-only rejection cleanup", async () => {
  let denied = true;
  const s=setup({loadSession:async()=>{if(denied)throw authError();return {user:{id:"a"}};}});
  await s.manager.adoptAppSession({authTokens:tokens,sessionToken:tokens.authToken,user:{id:"a"}}, "toss");
  expect(await s.manager.restoreStoredTossSession()).toBeNull();
  expect(s.values.get("trailbase.tossSession")).toBe("");
  denied=false;
  await s.manager.restoreStoredAppSession();
  expect(s.values.get("trailbase.tossSession")).toBe(s.values.get("trailbase.appSession"));
  expect(s.values.get("trailbase.tossSession")).not.toBe("");
});
test("legacy credential shapes are normalized once before no-op writes can be skipped", async()=>{
  for (const sessionToken of [undefined,"legacy-stale"]) {
    const s=setup();
    s.values.set("trailbase.appSession", JSON.stringify({authProvider:"anonymous",sessionToken,authTokens:tokens,user:{id:"a"}}));
    await s.manager.getOrCreateAppSession();
    expect(JSON.parse(s.values.get("trailbase.appSession")!).sessionToken).toBe(tokens.authToken);
    expect(s.writes).toHaveBeenCalledTimes(3);
    s.writes.mockClear();
    await s.manager.getOrCreateAppSession();
    expect(s.writes).not.toHaveBeenCalled();
  }
});
test("a Toss refresh synchronizes both mirrors once before loading unchanged user data", async()=>{
  const s=setup();
  await s.manager.adoptAppSession({authTokens:tokens,sessionToken:tokens.authToken,user:{id:"a"}}, "toss");
  s.writes.mockClear();
  await s.manager.renewAppSession();
  expect(s.writes).toHaveBeenCalledTimes(4);
  expect(s.values.get("trailbase.appSession")).toBe(s.values.get("trailbase.tossSession"));
});
test("anonymous identity writes settle before a superseding login reads the identity", async () => {
  const values = new Map<string,string>();
  let finish!:()=>void;
  let paused=false;
  let nextHash=0;
  let linkedHash="";
  const s=setup({
    storage:{getItem:key=>values.get(key)??null,setItem:async(key,value)=>{
      if(key==="trailbase.anonymousHash") {paused=true;await new Promise<void>(resolve=>{finish=resolve;});}
      values.set(key,value);
    }},
    createAnonymousHash:()=>`identity-${++nextHash}`,
    completeTossLogin:async input=>{linkedHash=input.anonymousHash;return {authTokens:renewed,user:{id:"a"}};},
  });
  const old=s.manager.getOrCreateAppSession().catch(error=>error);
  while(!paused)await new Promise(resolve=>setTimeout(resolve,0));
  const linked=s.manager.signInWithToss();
  finish();
  expect(await old).toBeInstanceOf(StaleAppSessionOperationError);
  await linked;
  expect(linkedHash).toBe("identity-1");
  expect(values.get("trailbase.anonymousHash")).toBe(linkedHash);
  expect(nextHash).toBe(1);
});
