# WebView SDK 3 adapters

`@trailbase-apps-in-toss-kit/ait-web` is a source-consumed WebView adapter for
`@apps-in-toss/web-framework >=3.4.0 <4`. The consumer owns that SDK dependency.
The kit installs 3.4.0 only for development type/bundle verification. RN consumers
continue to use `ait-rn` and `@apps-in-toss/framework` 2.x.

```ts
import { createAppsInTossWebAdapter } from '@trailbase-apps-in-toss-kit/ait-web';
const ait = createAppsInTossWebAdapter({ appKey: 'my-app' });
const login = await ait.login();
// Exchange login.authorizationCode and its unchanged DEFAULT/SANDBOX referrer
// through your authenticated backend flow. Never treat SANDBOX as a local stub.
```

The factory lazily loads current `TossAuth`, `User`, `Storage`, `Notification`,
`IAP` and `Share` namespaces. Merely importing/creating it does not load the SDK.
Methods with `isSupported()` are checked before native invocation; missing or
unsupported methods reject with `WebAdapterError`. SDK failures produce controlled
codes without raw response/error data. There is no automatic browser mock or
production fallback. Tests may supply an explicit `loadSdk` implementation.

## Sessions and SDK Storage

`ait.storage` implements the shared `KeyValueStorage` contract. Keys are prefixed
with `${appKey}.`; `getItem('appSession')` uses `my-app.appSession`. Existing SDK
Storage values under the same keys remain accessible. It never reads or copies
browser localStorage. Use it with the shared TrailBase session stores and
[session lifecycle](session-lifecycle.md) coordinator. Separate each app's keys,
clear account-scoped caches on account changes, and authenticate the current SDK
identity before reusing a stored session. Creating an adapter does not validate an
old session or automatically link/reassign accounts.

`anonymousHash()` uses `User.getAnonymousKey` and preserves/adds the `ait:` namespace.
The backend must verify that value through the existing anonymous identity proxy
boundary. It never invents a dev identity. `login()` preserves the one-time SDK
result so the backend can complete the real login exchange.

## Agreements and purchases

`requestNotificationAgreement(templateCode)` returns the SDK result, `OPTED_IN` or
`OPTED_OUT`, `source: 'apps_in_toss_sdk'` and both `templateCode`/`template_code`.
A rejection is never opt-in. Persist the actual functional template agreement on
the backend before sending a future alert; the proxy does not obtain consent.

```ts
const result = await ait.purchase({
  sku: 'coin-pack',
  processProductGrant: async ({ orderId }) => {
    // Verify owner, SKU and provider status, then grant exactly once on the server.
    return (await backend.verifyAndGrant(orderId)).granted === true;
  },
});
```

`subscribe` accepts the same mandatory backend callback plus `offerId`; its callback
also preserves `subscriptionId` when provided. Only literal `true` acknowledges the
callback; thrown/rejected callbacks return false. SDK success events are UI results,
not server proof of payment or entitlement. Keep IAP's private verification ledger
authoritative. Event APIs clean up once, including synchronous callbacks and timeout.
The default event timeout is 120 seconds (configurable up to 10 minutes). Timeout
or closing a client listener cannot cancel an already-created/paid order or an
in-flight backend grant. Reconcile its original order ID before another purchase.

`getPendingOrders`, `getProducts`, `getSubscriptionInfo` and `completeProductGrant`
preserve SDK responses, including future statuses and a false completion response.
Call completion only after a durable backend grant. Use existing IAP recovery
contracts to reconcile unknown/pending orders; never infer entitlement from a
subscription query alone. A lost response must not allocate a new transaction identity.

`createShareLink` accepts an `intoss://` path and `share` opens a share sheet. A
resolved share sheet is not evidence of sharing and does not issue a reward. For
other SDK surfaces such as ads/contacts viral, use their official SDK 3 APIs and
connect only app-owned credits to [server reward attempts](app-rewards.md), with
explicit server policies. This adapter does not wrap every SDK feature.

## Consumer migration and verification

Follow the official [SDK 3 migration guide](https://developers-apps-in-toss.toss.im/documentation/integration/sdk-3.x)
for `apps-in-toss.config.ts`, build scripts and Devtools. It currently asks consumers
that must preserve direct localStorage data to defer migration; this kit performs
no implicit origin-storage conversion. Once an SDK 3 bundle is released, the guide
says it cannot roll back to SDK 2.

Confirm CORS against the actual console bundle origin. The dated August 25, 2026
[release/test notice](https://developers-apps-in-toss.toss.im/guide/operation/toss)
uses `apps.tossmini.com`/`private-apps.tossmini.com` for new SDK 3 uploads, while the
generic migration guide still lists `web`/`private-web`. Apply the current console
notice and explicit app origins; do not allow wildcard origins or assume RN origins
changed. The kit does not rewrite a consumer's CORS policy.

Run `bun test packages/ait-web`, both `packages:typecheck` commands and a browser
bundle. The tests use explicit SDK fixtures and cover cleanup, unavailable methods,
failed grants, unchanged sandbox login, identity normalization and false/pending
outcomes. Browser compilation verifies the adapter imports no RN runtime; it does
not establish real-device login, payment, notification or ad eligibility. Perform
console QR/device checks before a consumer rollout.

Login preserves future string referrers as well as DEFAULT/SANDBOX. Purchase results require a usable original order ID (including an order_id compatibility alias); other native result metadata is preserved. A missing SDK disposer is tolerated, and supplied disposers are called once.

Purchase/subscription completion waits for both a valid success event and literal-true backend grant for the same order, in either arrival order. Repeated native grant callbacks for that order share one in-flight result. A timeout prevents new late grant callbacks from starting; already-running backend work still requires reconciliation.
