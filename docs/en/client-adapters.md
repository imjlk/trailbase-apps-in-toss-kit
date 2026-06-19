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

React Native apps should use the `ait-rn` notification helpers. Import the
official SDK function in the app and inject it into the bridge:

```ts
import {
  requestNotificationAgreement,
} from "@apps-in-toss/framework";
import {
  createAppsInTossFunctionalMessageClient,
  createAppsInTossNotificationAgreementBridge,
} from "@trailbase-apps-in-toss-kit/ait-rn/notifications";

const notifications = createAppsInTossNotificationAgreementBridge({
  requestNotificationAgreement,
});
const messages = createAppsInTossFunctionalMessageClient({
  baseUrl: apiBaseUrl,
  endpoints: {
    requestMessage: "/api/app/v1/messages/request",
    syncAgreement: "/api/app/v1/notification-agreements",
  },
  getAuthHeaders,
});

const agreement = await notifications.requestAgreement({
  templateCode: "ORDER_READY_AGREEMENT",
});

await messages.syncAgreement({
  result: agreement.result,
  templateCode: agreement.templateCode,
});

if (agreement.status === "OPTED_IN") {
  await messages.requestMessage({
    agreementTemplateCode: "ORDER_READY_AGREEMENT",
    context: { orderName: "Sample order" },
    providerRequestId: "order-ready:order-123",
    templateSetCode: "ORDER_READY",
  });
}
```

The bridge maps `newAgreement` and `alreadyAgreed` to `OPTED_IN`,
`agreementRejected` to `OPTED_OUT`, calls the SDK cleanup once, and fails closed
in production when the SDK bridge is unavailable. `templateCode` is the
notification agreement code passed to the SDK. `templateSetCode` is the
functional message send code used by the backend/proxy. They may be the same in
simple one-to-one flows, but shared agreement prompts should keep them separate.
Only enqueue or request the functional message when the synced agreement is
`OPTED_IN`; an `OPTED_OUT` result should be persisted without dispatch.

The functional message client only calls app-owned backend endpoints. It must
not call Toss Smart Message APIs, the mTLS proxy, or certificate-backed services
directly from React Native. The older
`@trailbase-apps-in-toss-kit/trailbase-client/apps-in-toss`
`requestAppsInTossNotificationAgreement` helper is kept for compatibility but
is deprecated for new React Native code.

## Apps in Toss Promotion Claims

Use `@trailbase-apps-in-toss-kit/ait-rn/promotion` when RN code needs a generic
campaign claim client. The client sends an app/backend `campaignId`; it never
accepts or forwards Toss Console promotion codes, raw Toss user keys, proxy
tokens, or certificate material.

```ts
import { createAppsInTossPromotionCampaignClient } from "@trailbase-apps-in-toss-kit/ait-rn/promotion";

const promotions = createAppsInTossPromotionCampaignClient({
  baseUrl: apiBaseUrl,
  claimEndpoint: "/api/app/v1/promotions/claim",
  getAuthHeaders,
});

const claim = await promotions.claim({
  campaignId: "daily-attendance",
  eligibilityId: "attendance-2026-06-19",
  requestId: "daily-attendance:user-123:2026-06-19",
});
```

The backend owns eligibility, idempotency, budget checks, campaign activation,
Toss promotion code selection, and the mTLS proxy call. The RN helper only
normalizes common claim results such as `GRANTED`, `ALREADY_GRANTED`,
`PENDING`, `FAILED`, `NOT_ELIGIBLE`, and `EXHAUSTED`.

## Apps in Toss React Native Session Utilities

For React Native non-game mini-apps, bootstrap anonymous TrailBase `_user`
records from the `{ type: "HASH", hash }` value returned by the Apps in Toss
SDK's `getAnonymousKey()`. The `@trailbase-apps-in-toss-kit/ait-rn` package
normalizes that value to `ait:${hash}` and provides a small storage wrapper that
replaces legacy `anon_...` values with the Apps in Toss key in production.

Apps that can use the kit's standard key shape should start with
`createAppsInTossSessionStorage({ appKey })`. For `appKey: "my-app"`, it creates
`my-app.anonymousHash`, `my-app.appSession`, and `my-app.tossSession`, wraps the
official Apps in Toss `Storage` API, and applies the anonymous identity wrapper.
Apps that must keep existing colon or versioned keys should keep using the
lower-level helpers until they plan a storage-key migration.

```ts
import {
  Storage,
  appLogin,
} from "@apps-in-toss/framework";
import {
  createAppsInTossLoginBridge,
  createAppsInTossSessionStorage,
} from "@trailbase-apps-in-toss-kit/ait-rn";
import { createAppsInTossSessionManager } from "@trailbase-apps-in-toss-kit/trailbase-client";

const env = process.env.APP_ENV ?? process.env.NODE_ENV;
const sessionStorage = createAppsInTossSessionStorage({
  appKey: "my-app",
  env,
  storage: Storage,
});
const loginBridge = createAppsInTossLoginBridge({
  appLogin,
  env,
});

// bootstrap, completeTossLogin, and loadSession are app-owned API callbacks.
export const sessionManager = createAppsInTossSessionManager({
  storage: sessionStorage.storage,
  anonymousHashStorageKey: sessionStorage.anonymousHashStorageKey,
  appSessionStorageKey: sessionStorage.appSessionStorageKey,
  tossSessionStorageKey: sessionStorage.tossSessionStorageKey,
  ...loginBridge,
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

`createAppsInTossLoginBridge()` is intentionally only a bridge adapter. It makes
production SDK unavailability fail closed and gives dev/test a clear fallback
authorization code, but it leaves `appLogin` result normalization to the shared
`createAppsInTossSessionManager` and `requestAppsInTossLogin` path. The Apps in
Toss `getIsTossLoginIntegratedService()` API reports whether the current user is
already linked for migration purposes, so keep raw migration checks in app UX or
data-migration code instead of using `false` to block first-time `appLogin`
flows.

For lower-level session persistence, wrap the official Apps in Toss `Storage`
API and pass it to `createAppsInTossSessionManager`. Apps in Toss documents this
native storage as persistent across app restarts and warns against
`AsyncStorage` in the mini-app runtime.

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

Some runtimes do not expose `GraniteModule.generateHapticFeedback` or
`BedrockModule.generateHapticFeedback`, which can break TDS components that call
haptics internally. Install the no-op fallback once from the app entrypoint, and
keep the React Native import in the app:

```ts
import { NativeModules } from "react-native";
import { ensureAppsInTossHapticFallback } from "@trailbase-apps-in-toss-kit/ait-rn";

ensureAppsInTossHapticFallback({ nativeModules: NativeModules });
```

For tiny app-local JSON state such as intro flags, visit sessions, or counters,
use `createPersistentJsonAtom()` with the same storage adapter. It provides
`read`, `write`, and `clear` without adding a React hook or subscription model:

```ts
import { createPersistentJsonAtom } from "@trailbase-apps-in-toss-kit/ait-rn";

export const introSeenAtom = createPersistentJsonAtom<boolean>({
  fallback: false,
  key: "my-app.introSeen",
  normalize: (value) => (typeof value === "boolean" ? value : null),
  storage: sessionStorage.storage,
});
```

The `ait-rn` package also exposes focused subpaths for apps that want smaller
imports: `./identity`, `./storage`, `./login`, `./haptics`, `./ads`,
`./share`, `./notifications`, and `./promotion`. The root import continues to
reexport the same public APIs.

For full-screen Apps in Toss ads, keep placement names, env variables, reward
granting, and server idempotency in the app. The kit only adapts the SDK's
callback API into a predictable `load -> show` Promise flow with per-`adGroupId`
preload dedupe and cleanup. In `auto` mode, sandbox and local-dev flows should
use mock rewards; set `rewardMode: "live"` only when the app intentionally
exercises the SDK path with an app-owned sandbox/test ad group ID:

```ts
import { loadFullScreenAd, showFullScreenAd } from "@apps-in-toss/framework";
import {
  createAppsInTossFullScreenAdBridge,
  shouldUseAppsInTossMockAd,
} from "@trailbase-apps-in-toss-kit/ait-rn/ads";

const ads = createAppsInTossFullScreenAdBridge({
  loadFullScreenAd,
  showFullScreenAd,
});

// Keep sandbox/test ad IDs in app-owned dev or sandbox config, not in the
// reusable kit import graph or a production release bundle. This value is only
// used when rewardMode intentionally forces the SDK path.
const adGroupId =
  operationalEnvironment === "sandbox"
    ? env.REWARDED_SANDBOX_AD_GROUP_ID
    : env.REWARDED_AD_GROUP_ID;

if (shouldUseAppsInTossMockAd({ isDev, rewardMode, operationalEnvironment })) {
  await grantLocalMockReward();
} else {
  const result = await ads.preloadAndShow({
    adFormat: "rewarded",
    adGroupId,
    preloadNext: true,
  });
  if (result.earned) {
    await grantRewardOnServer(result);
  }
}
```

For Apps in Toss share links, keep the copy and OG image selection in the app.
The share bridge only normalizes `intoss://` links, optionally prewarms a valid
OG image URL, calls `getTossShareLink()`, and passes the final message to
`share()`:

```ts
import { getTossShareLink, share } from "@apps-in-toss/framework";
import { createAppsInTossShareBridge } from "@trailbase-apps-in-toss-kit/ait-rn/share";

const shareBridge = createAppsInTossShareBridge({
  getTossShareLink,
  share,
});

const tossLink = await shareBridge.shareLink({
  appName: "my-app",
  message: "Try this round in Toss.",
  ogImageUrl: "https://example.com/og/round.png",
  path: "/rounds/current",
});
```

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
