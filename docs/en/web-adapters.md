# WebView SDK 3 adapters

`@trailbase-apps-in-toss-kit/ait-web` is a source-consumed WebView adapter for
`@apps-in-toss/web-framework >=3.4.0 <4`. The consumer owns that SDK dependency.
The kit installs 3.4.0 only for development type/bundle verification. RN consumers
continue to use `ait-rn` and `@apps-in-toss/framework` 2.x.

For anonymous caller authentication, `ait.createAnonymousKeyAuthCode()` delegates
to `@ait-kit/sdk` 0.7.0 and requires official WebView SDK 3.6+ at runtime. Existing
methods retain the 3.4.0 peer floor. Send the single-use code immediately to your
backend; do not persist it or fall back to `anonymousHash()` for authentication.
See [anonymous identity](anonymous-identity.md) for the private proxy/Rust exchange.

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
production fallback. Consumers may supply their own real SDK loader; tests may
supply an explicit fixture loader.

## Submodule installation and SDK ownership

Initialize the pinned submodule before installing the consumer's dependencies:

```sh
git submodule update --init --recursive
```

When consuming these source packages with Bun, merge the selected packages into
the consumer's workspace configuration. This resolves `ait-web`'s internal
`workspace:*` peer locally; a `file:` dependency alone does not register that peer.
For example (keep the consumer's other dependencies and workspace entries):

```json
{
  "private": true,
  "workspaces": [
    "vendor/trailbase-apps-in-toss-kit/packages/ait-web",
    "vendor/trailbase-apps-in-toss-kit/packages/trailbase-client"
  ],
  "dependencies": {
    "@apps-in-toss/web-framework": "3.6.0",
    "@trailbase-apps-in-toss-kit/ait-web": "workspace:*",
    "@trailbase-apps-in-toss-kit/trailbase-client": "workspace:*"
  }
}
```

Install and commit the consumer lockfile, then use frozen installs. Native Windows
consumers can use `bun install --linker hoisted` to avoid isolated-store path limits.
The kit's own dependencies use `bun run deps:install` from the kit checkout. Trust
each new checkout's reviewed mise config and install its tools before validation.

If kit development dependencies are installed inside the submodule, its default
loader can resolve the kit's SDK 3.4.0 rather than the consumer's newer SDK. Put
the loader in the consumer's module so the code-authentication flow selects the
consumer-owned SDK 3.6+:

```ts
import { createAppsInTossWebAdapter } from '@trailbase-apps-in-toss-kit/ait-web';
const ait = createAppsInTossWebAdapter({
  appKey: 'my-app',
  loadSdk: () => import('@apps-in-toss/web-framework'),
});
```

The 3.4.0 peer floor remains for existing APIs. This loader does not add runtime
support to an older Toss app, and unavailable code issuance must not fall back
to a client hash or fabricated code.

## Execute the minified consumer flow

A clean Windows consumer exposed a Bun 1.4.2 minification error in a fixture
loader that used `const sdk = await import(...)` followed by both `...sdk` and
nested `...sdk.User` spreads. The emitted code referenced an undefined variable,
and the adapter correctly reported a controlled `UNSUPPORTED` error. For explicit
SDK test overrides, destructure before spreading instead:

```ts
const { User, ...sdk } = await import('@apps-in-toss/web-framework');
return { ...sdk, User: { ...User, createAnonymousKeyAuthCode: issueFixtureCode } };
```

`issueFixtureCode` belongs only to an explicit synthetic test. Production uses
the real consumer-owned SDK loader shown above. Do not log codes/raw identities
or weaken the adapter's sanitized errors to diagnose a bundling failure.

`bun test packages/ait-web` now compiles a consumer with browser minification,
with and without chunk splitting, and executes its generated ESM. It verifies
lazy loading, fresh code issuance, shared namespace loading, no retries/hash
fallback on failure and controlled errors. This caught the failing spread form;
successful compilation or source-level tests alone did not. In each consumer,
also exercise its actual minified entrypoint's first login from a clean session,
then test account switching, reload and server restart. Existing tokens can hide
a broken bootstrap path. Synthetic fixture execution does not establish native
WebView/device support or real certificate/provider readiness.

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
Legacy proxy verification checks that key's validity only, not caller ownership;
public authentication requires the fresh code exchange described above. It never
invents a dev identity. `login()` preserves the one-time SDK
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
other supported SDK surfaces such as ads, use their official SDK 3 APIs and
connect only app-owned credits to [server reward attempts](app-rewards.md), with
explicit server policies. The legacy `contactsViral` reward integration has
been retired. This adapter does not wrap every SDK feature.

## Consumer migration and verification

Follow the official [SDK 3 migration guide](https://developers-apps-in-toss.toss.im/documentation/integration/sdk-3.x)
for `apps-in-toss.config.ts`, build scripts and Devtools. The current guide requires
SDK 3.1.1 or later when retaining SDK 2 browser localStorage data: SDK 3.0.0–3.1.0
used a different origin. This kit does not migrate or copy storage. After releasing
an SDK 3 bundle, rollback to SDK 2 is unsupported.

Confirm CORS against the actual console bundle origin. The current
[release/test notice](https://developers-apps-in-toss.toss.im/guide/operation/toss)
uses `apps.tossmini.com`/`private-apps.tossmini.com` for SDK 3.1.1+ and SDK 1/2,
while SDK 3.0.0–3.1.0 used `web`/`private-web`. The generic migration guide's
CORS section still lists the older family. Prefer the version-specific notice
and observed origin, with explicit app origins rather than wildcards. RN is
not a WebView CORS test target. See [device diagnostics](device-diagnostics.md).

Run `bun test packages/ait-web`, both `packages:typecheck` commands and a browser
bundle. The tests use explicit SDK fixtures and cover cleanup, unavailable methods,
failed grants, unchanged sandbox login, identity normalization and false/pending
outcomes. Browser compilation verifies the adapter imports no RN runtime; it does
not establish real-device login, payment, notification or ad eligibility. Perform
console QR/device checks before a consumer rollout.

Login preserves future string referrers as well as DEFAULT/SANDBOX. Purchase results require a usable original order ID (including an order_id compatibility alias); other native result metadata is preserved. A missing SDK disposer is tolerated, and supplied disposers are called once.

Purchase/subscription completion waits for both a valid success event and literal-true backend grant for the same order, in either arrival order. Repeated native grant callbacks for that order share one in-flight result. A timeout prevents new late grant callbacks from starting; already-running backend work still requires reconciliation.
