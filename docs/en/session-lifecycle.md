# Account Changes and App Foreground

Use one `createAppsInTossSessionManager` per storage namespace. Its operations now
supersede earlier operations: a late bootstrap, restore or login rejects with
`StaleAppSessionOperationError` instead of replacing newer credentials. Backend
callbacks receive `{ signal }` as an optional second argument; pass it to HTTP requests. Native SDK
dialogs and already-dispatched server mutations may not be cancellable. Serial
storage writes ensure an older in-flight write settles before newer credentials
or `clearSessions()` are written. Share the same manager between screens; separate
managers cannot coordinate writes to the same storage keys.
Each multi-key save/clear runs in one queue slot. A small
`<appSessionStorageKey>.writePending` marker blocks restoration after an interrupted
or failed storage write. `AppSessionStorageIncompleteError` requires explicit
`clearSessions()` or sign-in recovery; do not delete the marker by itself or restore
individual keys manually. Keep this internal key in the same persistent namespace.
Explicit anonymous bootstrap also refuses an incomplete namespace; clear it or
perform a fresh Toss sign-in first. Storage key names and the marker must be distinct.
Restoration preserves credentials on network, timeout and server failures. Only
`isInvalidSessionError(error) === true` clears rejected credentials; by default this
recognizes `TrailBaseHttpError` 401/403. Custom backend adapters should supply their
own authoritative invalid/revoked-session predicate. Other errors remain retryable.

`createAppsInTossSessionLifecycle` adds a single entry point for account transitions
and foreground refresh. It is exported from the package root, `apps-in-toss`, and
`session-lifecycle` entry points. Route auth operations through it after adoption.
Continue using official TrailBase authentication and server `_user` principals.

```ts
const lifecycle = createAppsInTossSessionLifecycle({
  manager,
  getUserId: (user) => user.id,
  clearUserData: async () => {
    await userQueryClient.cancelQueries();
    userQueryClient.clear();
    // Also clear app-owned user stores. Subscribers must hide stale screen data.
  },
  refreshEntitlements: (scope) => backend.readEntitlements({
    authTokens: scope.session.authTokens,
    signal: scope.signal,
  }),
  reconcilePending: (scope) => backend.queryPendingWork({
    authTokens: scope.session.authTokens,
    signal: scope.signal,
  }),
});
await lifecycle.start();
```

The backend and query client above are consumer-owned adapters. Reconciliation
queries existing order/request IDs; it must not blindly regrant inventory, allocate
new promotion keys, or resend messages whose outcome is unknown. Only backend
entitlements authorize benefits; cached SDK subscription status does not.

Transitions immediately abort the old scope and publish `transitioning` with no
session or entitlements. Old subscriptions and user caches are cleared before the
new session is acquired. Fresh entitlements and optional pending-work checks finish
before `ready` is published. A failure leaves no ready user data and rejects the
operation; show a retry/sign-in state. `getSnapshot()` and `subscribe(listener)`
support app-owned state binding; listeners should be synchronous and must not throw.

Use the current scope for requests, cache keys and callbacks:

```ts
const scope = lifecycle.getSnapshot().scope;
if (scope) {
  const key = scope.cacheKey('balance'); // principal + revision, including A → B → A
  const value = await scope.run((current) => backend.readBalance({
    authTokens: current.session.authTokens, signal: current.signal,
  }));
  scope.commit(() => setBalance(value)); // synchronous updates only; no await inside
  const subscription = subscribeBalance((value) => {
    scope.commit(() => setBalance(value));
  });
  await scope.registerCleanup(() => subscription.close());
}
```

`run` rejects obsolete results even when the backend ignores abort; `commit` only
updates a currently ready scope. Do not mutate global UI/cache state inside async
tasks before the guarded commit. Register subscription cleanup immediately after
creation, pass the signal during asynchronous setup, and handle cancellation when
leaving a screen. Cleanup callbacks may be async; every registered callback is
attempted even when another fails. Registration on an already closed scope runs
cleanup immediately. A rejected operation still needs a caller rejection handler.

On a real return to foreground, call `resume()`. It revalidates the stored session
and current entitlements instead of automatically bootstrapping after revocation:

```ts
let previous = AppState.currentState;
const subscription = AppState.addEventListener('change', (next) => {
  const returned = next === 'active' && previous !== 'active';
  previous = next;
  // SDK login can itself change AppState; do not interrupt an auth transition.
  if (returned && lifecycle.getSnapshot().phase === 'ready') {
    void lifecycle.resume().catch(showSessionError);
  }
});
// On app-root teardown: subscription.remove(); await lifecycle.dispose();
```

See the official [React Native AppState reference](https://reactnative.dev/docs/appstate).
Bind the listener once at the app root. `signInWithToss()` switches to the backend's
canonical principal; merging anonymous progress or currency is a server-owned app
policy, not a client-side copy operation. `disconnect()` clears local credentials
and current user resources. It does not invoke Toss unlink or revoke server tokens;
perform authenticated server unlink/revocation separately and enforce disabled
accounts in backend endpoints. See [Toss Login](https://developers-apps-in-toss.toss.im/guide/authentication/intro).
After disconnect, use an explicit start/sign-in action. `dispose()` closes the
lifecycle without deleting persisted credentials, so normal app termination does
not sign the user out.
Disposal is final, including cleanup failure: repeated `dispose()` calls return
the same cleanup outcome. Handle that failure in the app's teardown path; a disposed
lifecycle cannot be reused or subscribed to again.
Disconnect attempts credential deletion even if user-resource cleanup fails, then
reports cleanup errors separately through the rejected operation.

No schema migration or proxy deployment is required. Validate canonical-account
upgrades, delayed A-account requests after switching to B, changed subscription
rights on foreground, failed cleanup, and reconnect after unlink in the consumer.

## Restore and refresh anonymous sessions

Passwordless UX can still use a service-managed TrailBase password during bootstrap.
Avoid repeating that login on every launch: provide `refreshAuthTokens` to the existing
session manager, and make `loadSession` an authenticated app-data endpoint that does
not issue tokens or invoke bootstrap.

```ts
import { createTrailBaseTokenRefresher } from "@trailbase-apps-in-toss-kit/trailbase-client";
// Additional createAppsInTossSessionManager options:
const sessionOptions = {
  refreshAuthTokens: createTrailBaseTokenRefresher({ baseUrl }),
  // Classify only authoritative credential rejection (not a generic 403,
  // a disabled account, a permissions error, a timeout, or an outage).
  isInvalidSessionError: error => error instanceof TrailBaseHttpError && error.status === 401,
};
```

`getOrCreateAppSession()` coalesces concurrent acquisitions. It loads fresh app data
using persisted credentials; expiring JWTs (within 60 seconds) refresh first, and
rejected access tokens get one refresh and data retry. Tokens are only scheduling
hints on the client; the server must validate authentication and account status.
`renewAppSession()` forces refresh for expiry timers or rejected requests and recovers
with bootstrap only after an authoritative invalid-session error or absent storage.
If refresh is unavailable, the normal load/bootstrap recovery remains available.

The official refresh helper calls `/api/auth/v1/refresh`, retains an omitted refresh
token, and accepts a rotated one. Refreshed credentials are persisted before the data
request so an outage cannot discard rotation. Network/storage errors preserve the
session and propagate; corrupted JSON is treated as absent storage. Keep storage
namespaces separate per backend/environment. Data responses can omit credentials.

App-owned account-link flows must call `adoptAppSession(response, "toss")` with the
canonical user's tokens before exposing the new session. This supersedes pending
refreshes and mirrors the new credentials to both storage keys. Use
`clearSessions()` on disconnect and one manager per namespace. Do not automatically
replay mutations after refreshing; the app owns idempotency and retry decisions.
The refresh option is additive; applications using custom session tokens can keep
using their existing callbacks.
