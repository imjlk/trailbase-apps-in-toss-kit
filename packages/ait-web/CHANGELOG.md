# @trailbase-apps-in-toss-kit/ait-web

## 0.3.1 — 2026-09-22

### Patch changes

- [f8b760b](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/f8b760bc9b773176749fe4728d6513e2d00ebee4) Pin the shared Apps in Toss SDK adapters to 0.4.0, which includes the reviewed React Native and Web review and direct-promotion adapter contracts. — Thanks @imjlk!

## 0.3.0 — 2026-09-16

### Minor changes

- [7d165be](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/7d165be8c96a6d65d9a96ae57d7545adab57528c) Adopt @ait-kit/sdk 0.3.0 (exact pin) and harden local ad-flow settlement.
  
  - `@ait-kit/sdk` moves from `^0.2.0` to `0.3.0` in `ait-rn` and `ait-web`.
    The SDK's peer floor raises the RN minimum to
    `@apps-in-toss/framework@>=2.10.10`: the `ait-rn` peer bound and the exact
    `framework-min-supported` fixture moved from 2.5.0 to 2.10.10 together, so
    `bun run packages:typecheck:minimum` now compiles against the same reviewed
    pin. WebView consumers keep `>=3.4.0 <4`. Consumers running older RN
    frameworks must upgrade before taking this kit version.
  - Local full-screen ad cleanup can no longer strand a pending promise: show
    and injected-load settle paths now resolve/reject before running SDK
    listener cleanup, and cleanup runs once, best-effort — a throwing cleanup
    never replaces the settled result (matching the existing IAP and
    share-reward behavior).
  - Default-loader delegation (RN login, anonymous key, ad load, IAP
    purchases and pending orders; web identity, storage, share) is now covered
    by dedicated tests that mock the official SDK module instead of injecting
    replacement functions, including immediate retry after a failed ad load,
    load-then-show, IAP order-id mismatch, duplicate grant callbacks, and
    storage failure propagation. Real Toss app verification remains a
    consumer responsibility.
  - Web share results map the SDK 0.3.0 `completed` status (0.2.x `closed`)
    to call completion only; only `failed` rejects. — Thanks @imjlk!

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

