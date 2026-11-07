# React Native to WebView Migration

The kit now treats the WebView SDK 3 path (`@apps-in-toss/web-framework` with
`ait-web`) as the target for new client work. This guide covers the support policy
for the React Native adapter, how to check a consumer app's remaining RN surface,
and a staged cutover that preserves existing users, sessions and server state.

## Support policy

- **`ait-rn` is in maintenance mode.** It keeps receiving fixes for bugs, security
  issues, `@apps-in-toss/framework` 2.x compatibility and anything needed to
  carry state across the cutover. It does not get new subpaths or RN-only features.
- **New client helpers are platform-neutral first.** Shared logic lands in
  `ait-core` and is exposed through `ait-web` (and through `ait-rn` only when an
  existing RN subpath already owns that concept). Backend clients that only call
  app-owned endpoints must not be added to `ait-rn` alone.
- **RN consumers keep working.** Consumer apps pin a submodule revision, and
  `ait-rn` stays in the workspace while consumer apps still ship RN bundles.
  Removing it will be announced in a changeset only after every subpath in the
  migration map has a WebView path and consumer apps report a WebView-only stage.
- **Cutover is forward-only per app.** After an SDK 3 bundle is released, rollback
  to an SDK 2 bundle is unsupported. Plan for fix-forward, not rollback.

The official Apps in Toss documentation still describes both RN and WebView
development. This policy is the kit's own choice: SDK 3 WebView receives the
active release stream, and SDK 3 moves SDK logic to the server so Toss can ship
fixes without a partner redeploy. Check the official docs before telling a team
that RN itself is unsupported.

## Check a consumer app

Run the advisory checker from the consumer repository:

```sh
node vendor/trailbase-apps-in-toss-kit/scripts/check-consumer-webview-migration.mjs --root .
```

It reads `package.json` files and import statements only. It does not import,
install or execute anything, and it skips `node_modules`, `vendor`, build output
and dot directories. The report shows:

- **Stage**: `rn-only`, `dual` (RN and WebView packages side by side),
  `webview-only` or `none`.
- **Footprint**: where `ait-rn`, the RN SDK, RN UI packages, `ait-web` and the
  WebView SDK are declared or imported, plus `granite.config.*` and
  `apps-in-toss.config.*` locations.
- **Items** for each imported `ait-rn` name, most urgent first:
  - `blocked`: no complete WebView replacement in this kit revision. The item
    names the gap and, where possible, the SDK 3 APIs to call in the meantime.
  - `rewrite`: replaced by a WebView adapter API such as `ait.login()`.
  - `swap-import`: the same name exists under the listed `ait-web` subpath.
  - `review`: type-only, namespace, dynamic or unknown imports to check by hand.

Use `--json` for tooling. `--strict` (or `CI_STRICT=1`) fails while any
`ait-rn` or `@apps-in-toss/framework` footprint remains. Enable it in consumer CI
after retiring the RN app so RN imports cannot come back. The report is static
analysis: device and QR tests still decide login, payment, ad and storage behavior.

The checker reads `data/webview-migration-map.json`. The `ait-web` package tests
keep that map exact. Every `ait-rn` runtime export must be classified, every
same-name entry must exist for WebView, and a pending name fails the test as soon
as a WebView export with that name lands, so the map cannot go stale silently.

## Module status

Status at this kit revision. The map file is the source of truth.

| ait-rn subpath | WebView path | Remaining gap |
| --- | --- | --- |
| `ait-rn/ad-skip` | `ait-web/ad-skip` | None |
| `ait-rn/ads` | `ait-web/ads` | Runtime helpers it re-exports (see `runtime`) |
| `ait-rn/analytics` | `ait-web/analytics` | None (`Analytics.log`, explicit `mapEvent`) |
| `ait-rn/engagement` | `ait-web/engagement` | None (drive it from document visibility) |
| `ait-rn/storage` | `ait-web/storage`, `ait.storage` | None |
| `ait-rn/login` | `ait.login()` | None |
| `ait-rn/identity` | `ait.createAnonymousKeyAuthCode()` | None (SDK 3.6+ and proxy code exchange) |
| `ait-rn/haptics` | SDK 3 `generateHapticFeedback` | None (no wrapper planned) |
| `ait-rn/notifications` | `ait.requestNotificationAgreement()` | Functional message backend client |
| `ait-rn/iap` | `ait.purchase()`, `ait.subscribe()` and order queries | Pending-order restore flow, grant backend client |
| `ait-rn/share` | `ait.createShareLink()`, `ait.share()` | Message, deep-link and OG image helpers |
| `ait-rn/inline-ads` | `createWebViewBannerAds` from `ait-web/ads` | Placeholder decision helpers |
| `ait-rn/promotion` | None yet | Campaign claim and status clients |
| `ait-rn/shopping` | None yet | Link normalizers and open bridge |
| `ait-rn/runtime` | None yet | Safe environment, platform, version and network helpers |
| `ait-rn/diagnostics` | None yet | Runtime diagnostics collector |

Most remaining gaps are platform-neutral code (backend clients, normalizers,
placeholder policy) that should move into `ait-core` rather than be rewritten.

## Staged cutover

Migrate one app at a time. Each stage should be releasable on its own.

### 1. Inventory

Run the checker and sort out `blocked` items first. Either wait for the kit to
add the WebView path, or use the interim SDK 3 APIs the report lists inside the
app and switch to the kit helper later. Decide how screens move: RN components
and TDS React Native become React DOM with the TDS Web packages, while domain
logic stays in shared workspace packages both apps import.

### 2. Backend first, in a dual-stack window

Change the backend before shipping any WebView bundle, and keep it compatible
with the RN bundle that is still live.

- Require the proxy capability `anonymous-key.exchange-auth-code` through the
  [Release Doctor](release-doctor.md) recipe, then add the WebView bootstrap that
  exchanges a fresh code once. See [anonymous identity](anonymous-identity.md):
  the exchanged key keeps the existing `ait:` HMAC seed and account mapping.
- Keep the legacy RN bootstrap routes enabled for as long as any RN bundle can
  still run. Do not retire them in the same release that adds the WebView route.
- Configure CORS with explicit origins for the observed SDK 3 bundle origins and
  local development. RN never needed CORS, so this is usually the first
  WebView-only backend change. See [WebView adapters](web-adapters.md).
- Use forward migrations only. Before replacing a production service, back up
  every TrailBase database plus depot and fresh-start state, restore the backup
  into a network-isolated container, and compare business-table row counts and
  content fingerprints. Keep the original volumes attached.

### 3. Build the WebView app next to the RN app

Add the WebView app as a separate workspace package with `apps-in-toss.config.*`.
The consumer owns `@apps-in-toss/web-framework`. Register `ait-web`, `ait-core`
and `trailbase-client` in Bun workspaces and pass the SDK loader from the
consumer's own module (see [WebView adapters](web-adapters.md)). Keep the RN app
building as a regression reference until the retirement stage.

### 4. Prove continuity

These are the properties existing users notice. Verify each one explicitly.

- **Identity**: an anonymous user and a Toss-login-linked user created by the RN
  bundle must resolve to the same TrailBase `_user` after the WebView bootstrap.
  Cover this in a backend smoke test that creates accounts the RN way on the
  previous server version, then boots through the WebView route.
- **Sessions**: `ait.storage` prefixes keys with `${appKey}.`, which matches the
  keys `createAppsInTossSessionStorage` wrote. If the RN app used a custom or
  default literal key, read it through `createAppsInTossSdkStorageBridge` instead.
  If a stored session cannot be read, the WebView app must re-authenticate with a
  fresh code. It must never create a second account or fall back to a client hash.
- **In-flight work**: pending IAP orders, ad skip request IDs and promotion
  intents reconcile on the server. Keep their storage keys and request IDs
  unchanged so the WebView bundle picks up what the RN bundle started.
- **Server records**: notification agreements, Toss Login links, owned-currency
  balances and ledgers live on the server and carry over unchanged.

### 5. Verify

Run the kit tests at the pinned revision, build the consumer's minified bundle,
and run browser end-to-end tests with explicit SDK fixtures (these are not device
evidence). Then run the backend continuity smoke and private QR tests on iOS and
Android. Cover login, account switching, purchase and restore, ads, notification
agreement and sharing.

### 6. Release and watch

Upload the SDK 3 bundle and keep the legacy routes and RN-compatible tables in
place. Watch bootstrap failures and duplicate-account signals. Fix forward;
do not try to roll back to the SDK 2 bundle.

### 7. Retire the RN path

Once the RN bundle can no longer be served to users, disable the legacy hash
bootstrap routes. Then remove the RN app, `@apps-in-toss/framework` and the
`ait-rn` workspace entry, and turn on `--strict` for the checker in consumer CI.

## What the kit does not do

The kit does not migrate screens, release bundles, copy browser localStorage,
or prove device support. It provides the shared helpers, the migration map and
checker, and these runbook rules. Each consumer app owns its UI port, its backend
dual-stack window and its device acceptance.
