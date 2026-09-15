# @trailbase-apps-in-toss-kit/ait-web

## 0.2.0 — 2026-09-15

### Minor changes

- [4832939](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/483293969ef46bf0d194b8cd16ca6d6c81942d90) Delegate common Apps in Toss SDK operations to @ait-kit/sdk instead of reimplementing module acquisition, event settle-once handling, deadline budgets, and cleanup locally. Public imports and signatures are unchanged.
  
  - `ait-rn` (new dependency `@ait-kit/sdk ^0.2.0`): the default (non-injected) login, anonymous-key lookup, full-screen ad load, IAP purchase, and pending-order paths now run on `@ait-kit/sdk/rn` adapters with TrailBase's error taxonomy mapped on top; injected seams (`appLogin`, `getAnonymousKey`, `loadFullScreenAd`, `IAP`) keep the local synchronous flows. New `createAppsInTossSdkStorageBridge()` provides the sdk-backed native storage bridge.
  - `ait-web` (new dependency `@ait-kit/sdk ^0.2.0`): `anonymousHash()`, `storage.*`, `createShareLink`, and `share` run on `@ait-kit/sdk/web` adapters behind one memoized SDK load; the `ait:` prefix policy, strict result checks, and appKey namespacing stay local.
  - Boundary (documented in `docs/{en,ko}/ait-kit-sdk-delegation.md`): ad show heuristics, IAP product/subscription queries, web login/notification/purchase flows (pinned TrailBase contracts), session bootstrap, legacy-hash migration, and all server callbacks remain TrailBase-owned.
  - Consumer-visible default-path changes: RN anonymous-key validation failures now report `ANONYMOUS_KEY_INVALID_RESPONSE` (the local `ANONYMOUS_KEY_ERROR` distinction survives only for injected functions), and default-path RN purchases report grant failures as `IAP_PRODUCT_GRANT_FAILED` (the restore flow keeps `IAP_PRODUCT_GRANT_TIMEOUT`).
  - Platform isolation is enforced by new consumer-fixture tests: RN sources never import the web SDK entries and vice versa, and both official SDKs stay optional peers. — Thanks @imjlk!

## 0.1.1 — 2026-09-13

### Patch changes

- Updated dependencies: trailbase-client (npm)@1.1.1

## 0.1.0 — 2026-09-12

### Minor changes

- [abca25d](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/abca25d969d9ffabd37a6fe71f4ab724fad0d281) Add a private source-consumed WebView SDK 3 adapter for SDK Storage, Toss login,
  verified-anonymous bootstrap input, functional notification agreement, one-time
  and subscription purchases, pending/status/completion queries and sharing.
  Consumers own @apps-in-toss/web-framework >=3.4.0 <4. RN consumers remain on ait-rn.
  
  The adapter uses current namespaces, availability checks and bounded event cleanup;
  backend grant callbacks must explicitly return true. There is no automatic mock,
  localStorage migration, account reassignment or client-side payment verification.
  Preserve existing SDK Storage keys, check real console origins/device behavior, and
  reconcile original order IDs after timeout before another purchase. — Thanks @imjlk!

