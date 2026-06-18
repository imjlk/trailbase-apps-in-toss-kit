# TrailBase Client Adapters

The `trailbase-client` package is not a replacement for the official TrailBase
SDK. It contains AppsInToss and React Native glue that repeats across consumer
apps.

Use the official `trailbase` JavaScript SDK for auth state, token refresh, and
Record API access. The kit only normalizes token payloads returned by
AppsInToss bootstrap endpoints and can convert them into the SDK's
`{ auth_token, refresh_token, csrf_token }` shape.

Use it when consumer apps are repeating request handling, TrailBase error
normalization, anonymous hash storage, or React Native SSE bridging. Keep
product-specific API methods in the app.

## Core Utilities

Shared client utilities include:

- base URL normalization
- JSON request and response parsing
- automatic JSON serialization for plain request bodies
- TrailBase error normalization
- anonymous hash resolution through a storage adapter
- TrailBase auth token normalization and `trailbase` SDK token option helpers
- SSE parsing
- XMLHttpRequest-backed stream helpers for React Native runtimes

`createAnonymousHash()` is a local/dev/test fallback helper. Do not use it as a
production identity seed for Apps in Toss React Native non-game apps; use the
`@trailbase-apps-in-toss-kit/ait-rn` helpers backed by the mini-app scoped
`getAnonymousKey()` value instead.

Consumers should keep domain-specific client methods in their app packages. The
kit should only provide reusable transport and adapter pieces.

## Apps in Toss SDK Calls

Apps in Toss SDK calls remain app-owned because they run inside the mini-app
runtime. For functional Smart Message flows where a user asks to receive a
future alert, call `requestNotificationAgreement({ options: { templateCode } })`
from `@apps-in-toss/framework` or `@apps-in-toss/web-framework`, then send the
result to the app backend so it can persist the agreement before dispatch.

The `./apps-in-toss` subpath reexports the shared Toss Login/session helpers and
adds a thin notification agreement adapter. Import the official SDK function in
the app and inject it into the kit helper:

```ts
import { requestNotificationAgreement } from "@apps-in-toss/web-framework";
import {
  requestAppsInTossNotificationAgreement,
} from "@trailbase-apps-in-toss-kit/trailbase-client/apps-in-toss";

const agreement = await requestAppsInTossNotificationAgreement({
  requestNotificationAgreement,
  templateCode: "ORDER_READY",
});

await api.saveNotificationAgreement(agreement);
```

The helper maps `newAgreement` and `alreadyAgreed` to `OPTED_IN`,
`agreementRejected` to `OPTED_OUT`, and sets `source` to `apps_in_toss_sdk`.
It returns the functional notification template as `template_code` for backend
storage, without forwarding the raw SDK event payload.
The shared `trailbase-client` package does not depend on `@apps-in-toss/*`;
WebView and React Native apps own the official SDK import.

## Apps in Toss React Native Identity

For React Native non-game mini-apps, bootstrap anonymous TrailBase `_user`
records from the `{ type: "HASH", hash }` value returned by the Apps in Toss
SDK's `getAnonymousKey()`. The `@trailbase-apps-in-toss-kit/ait-rn` package
normalizes that value to `ait:${hash}` and provides a small storage wrapper that
replaces legacy `anon_...` values with the Apps in Toss key in production.

```ts
import { Storage } from "@apps-in-toss/framework";
import { createAppsInTossIdentityStorage } from "@trailbase-apps-in-toss-kit/ait-rn";
import { createAppsInTossSessionManager } from "@trailbase-apps-in-toss-kit/trailbase-client";

const identityStorage = createAppsInTossIdentityStorage(Storage, {
  anonymousHashStorageKey: "my-app.anonymousHash",
  appSessionStorageKey: "my-app.appSession",
  production: true,
});

// appLogin, bootstrap, completeTossLogin, and loadSession are app-owned callbacks.
export const sessionManager = createAppsInTossSessionManager({
  storage: identityStorage,
  anonymousHashStorageKey: "my-app.anonymousHash",
  appSessionStorageKey: "my-app.appSession",
  appLogin,
  bootstrap,
  completeTossLogin,
  loadSession,
});
```

In production, the helper throws `AppsInTossIdentityError` instead of creating
a random value when the Apps in Toss SDK cannot return a `{ type: "HASH" }`
result. In dev/test, local runs can opt into the `dev-anon_...` fallback.
When using a custom app-session storage key, pass the same key to the identity
storage wrapper so legacy anonymous sessions are ignored after the helper
refreshes the stored anonymous hash.

For session persistence, wrap the official Apps in Toss `Storage` API and pass
it to `createAppsInTossSessionManager`. Apps in Toss documents this native
storage as persistent across app restarts and warns against `AsyncStorage` in
the mini-app runtime.

```ts
import { Storage } from "@apps-in-toss/framework";
import {
  createAppsInTossKeyValueStorage,
  createAppsInTossSessionManager,
} from "@trailbase-apps-in-toss-kit/trailbase-client/apps-in-toss";

const sessionStorage = createAppsInTossKeyValueStorage({
  storage: Storage,
  env: "production",
});

const sessionManager = createAppsInTossSessionManager({
  storage: sessionStorage,
  appLogin,
  loadSession,
  bootstrap,
  completeTossLogin,
});
```

Local tests can pass `createMemoryKeyValueStorage()` or a localStorage-backed
adapter as `fallbackStorage`. Production builds should not enable fallback when
`Storage` is unavailable.

## TanStack DB

The TanStack DB adapter is intentionally thin. It helps build TrailBase Record
API collections with a React Native friendly SSE bridge, snapshot loading, and
reconnect hooks while leaving table names, query filters, and record models in
the consumer app.

XHR-backed SSE subscriptions support caller-provided headers for authenticated
Record APIs and surface HTTP failures as `TrailBaseHttpError` instead of silently
closing the stream.

The `./tanstack-db` subpath depends on the pinned `@tanstack/react-db` version
shipped with the kit so consumer apps can reuse the same adapter surface through
the submodule. `@tanstack/react-query` and `trailbase` remain optional peer
dependencies for apps that opt in to query defaults or official TrailBase SDK
access. The supported `trailbase` peer range starts at `0.12.1`, which is the
current SDK version verified for `client.login()`, `client.tokens()`, and
`client.headers()`.

## TanStack Query

The TanStack Query subpath provides small defaults and option helpers. It avoids
wrapping application queries because query keys, stale times, and mutation
behavior should remain app-owned.

## Compatibility

Consumer apps can adopt the subpaths independently. Use the core utilities first
when an app only needs request/error/storage helpers, add the TanStack Query
helpers when shared query defaults become useful, and add the TanStack DB adapter
only after the app has repeated Record API snapshot and realtime collection code.

If an app already has a stable client layer, migrate one repeated concern at a
time. The expected result is less transport code, not a different application
data model.
