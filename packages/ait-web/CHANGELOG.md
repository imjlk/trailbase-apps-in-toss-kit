# @trailbase-apps-in-toss-kit/ait-web

## 0.6.0 — 2026-11-09

### Minor changes

- [0e0caae](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/0e0caae7434c75b90f94de480a3e8538e60ad796) Share the remaining platform-neutral RN helpers with WebView through `ait-core`. `ait-web` adds `notifications` (functional message client and agreement result normalization), `iap` (backend grant client and `AppsInTossIapBridgeError`), `promotion`, `share` (an SDK 3 share-link bridge with the same deep-link, OG image and message behavior as RN) and `shopping`; `ait-web/ads` now includes the inline ad placeholder policy. RN imports, error class identities and runtime behavior are unchanged, and `ait-rn/share` additionally re-exports the shared `createShareBridge` factory.
  
  Consumers updating to this revision must keep `vendor/trailbase-apps-in-toss-kit/packages/ait-core` registered in their Bun workspaces and regenerate their lockfile. Re-run `check-consumer-webview-migration.mjs`: these names now report as swap-import. The remaining WebView gaps are the runtime environment helpers, the diagnostics collector and the IAP pending-order restore flow. Device QR checks still decide share-sheet, shopping-link and purchase behavior. — Thanks @imjlk!
- [219f228](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/219f228dada7914d6e9cce07179ef29e56994ec6) Close the last WebView gaps in the migration map. `ait-web` adds `runtime` (the same safe operational environment, platform, Toss app version, network and minimum-version helpers as RN, read from the SDK 3 `Environment` and `Device` namespaces instead of the deprecated top-level getters), `diagnostics` (the same opt-in `ait-runtime-diagnostics-v1` snapshot) and `createAppsInTossIapRestoreBridge` in `ait-web/iap`. The restore bridge runs the RN `restorePendingOrders` loop with the same options, results and error codes: it acknowledges an order with `completeProductGrant` only after the backend grant for that order succeeded. `ait-web/ads` re-exports the runtime helpers the same way `ait-rn/ads` does.
  
  The RN runtime helpers, diagnostics collector and IAP restore loop now share their implementation with WebView through `ait-core`. RN exports and behavior are unchanged, except that `isAppsInTossRuntimeSupported` now treats a non-boolean SDK result as unsupported.
  
  Re-run `check-consumer-webview-migration.mjs`: no `ait-rn` import reports as blocked at this revision. Root imports of runtime helpers now resolve to `runtime` through the new `reexportsFrom` map field. At WebView startup, restore pending orders with the same idempotent backend grant the RN bundle used, and confirm purchase and restore on iOS and Android with private QR tests. — Thanks @imjlk!
- [f9170fb](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/f9170fb8da2aa270c9df9ca5ad8956dfac080cd1) Keep the RN account check when stored sessions move to WebView. `ait-web/storage` adds `createAppsInTossWebSessionStorage`, which wraps `ait.storage` with the same guard as the RN session storage. It reads the `${appKey}.appSession`, `${appKey}.tossSession` and `${appKey}.anonymousHash` keys the RN bundle wrote. When the Toss account on the device changed, it clears both sessions and returns null instead of restoring another account's session. The anonymous hash only detects an account change; WebView authentication still exchanges a fresh code. A session saved before any account is recorded, such as `adoptAppSession` on a first launch, now records the current account first, so the next read keeps it instead of discarding it. That lookup gives up after 10 seconds: the save rejects without writing, so a stalled SDK call cannot hold a later logout clear or save after it. With `revalidateAnonymousHash` (the WebView default), the account check and session cleanup run as one queued step, so a delayed check from an earlier read can no longer clear a session saved after the account switched. The RN guard now lives in `ait-core`; RN sessions get the same two fixes and are otherwise unchanged. The migration map no longer suggests reading session keys through plain `ait.storage`.
  
  `check-consumer-webview-migration.mjs` now ignores imports inside comments, strings and template text, and finds imports with comments between their tokens, inside template `${...}` expressions and in escaped specifiers. It tells division from regex literals after `++`, `--` and statement conditions, even with long comments before the condition, and restores quoted import names. It reports type-only imports for manual review instead of runtime guidance. It rejects a missing or non-directory `--root` with exit code 2. Unreadable directories, unparsable `package.json` files and source files over 2 MiB are listed as `scanIssues`, and `--strict` fails while any remain. The text report now prints file paths and each module's migration note, including for namespace and other unclassified imports. — Thanks @imjlk!

### Patch changes

- [01e5343](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/01e53435afe67eb3efc6f7698f738144ddfe19a4) Session reads now give up on an SDK account lookup that does not answer within 10 seconds, the same bound session saves already use. A stalled `getAnonymousKey` call no longer hangs session restore: the read rejects without recording an account or clearing a session, and a late SDK answer is ignored. Treat the rejected read as no stored session, as for any failed lookup. RN session storage gets the same bound; RN apps that previously waited indefinitely now see the read reject after 10 seconds.
  
  With account revalidation on (the WebView default, or RN `revalidateAnonymousHash: true`), a session save made before a read has confirmed the Toss account in the current app process now checks the account first. An app that treats a failed read as no stored session and signs in again therefore records the new account instead of storing its session under the previous account's hash, where a later read as that account would restore it. If that check also fails, the save rejects without writing. RN storage without revalidation is unchanged. — Thanks @imjlk!
- [56591fd](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/56591fdd64723161b52a7616a9bb6d0e111ffaa7) Preserve explicit purchase and subscription cancellations so consumers can restore their purchase controls without showing a payment failure. — Thanks @imjlk!
- Updated dependencies: ait-core (npm)@0.3.0

## 0.5.0 — 2026-11-05

### Minor changes

- [d970562](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/d970562e4a1f243cc8154ebf76ed903c04644218) Share full-screen ad lifecycle, ad skip reconciliation, persisted JSON state,
  analytics and engagement helpers between RN and WebView adapters. WebView adds
  SDK 3 ad loading, DOM banner delegation, verbatim-key Storage and Analytics.log
  integration. Existing RN entry points and long-ad completion behavior remain.
  
  Consumers updating either adapter must register
  `vendor/trailbase-apps-in-toss-kit/packages/ait-core` alongside their adapter and
  `trailbase-client` in Bun workspaces, then regenerate their lockfile. The kit does
  not migrate screens or release consumer bundles. Validate fresh-code authentication,
  storage continuity, ads and skip receipts on devices before an SDK 3 rollout;
  SDK 3 releases cannot roll back to SDK 2.
  
  Include the shared client workspace manifest in filtered proxy image builds.
  Proxy runtime routes and certificate mounts are unchanged. — Thanks @imjlk!

### Patch changes

- Updated dependencies: ait-core (npm)@0.2.0

## 0.4.0 — 2026-10-16

### Minor changes

- [6fe06ec](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/6fe06ec6794fb916e23ed76a29d5ac1e531f4ff9) Adopt published @ait-kit/sdk 0.7.0 and api-core/api-client 0.6.0. WebView consumers on official SDK 3.6+ can request fresh anonymous authentication codes and exchange them once through the private proxy and Rust helper before official TrailBase login. The old key-verification route only checks key validity and must not authenticate an untrusted caller. Require proxy capability anonymous-key.exchange-auth-code before adoption; keep codes and raw keys out of storage, logs and public responses. Existing identity HMAC seeds and account mappings are preserved; no schema migration is required for code exchange. Older SDK peers retain existing APIs but this opt-in method returns unsupported without falling back to a hash or login. — Thanks @imjlk!

## 0.3.4 — 2026-10-02

### Patch changes

- [318e55f](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/318e55fb60c65d9ca4793ea83fda804f9e57a199) Adopt the published @ait-kit/sdk 0.6.0 in both frontend adapters and document explicit, bounded SDK call diagnostics. Consumers with a direct SDK dependency should pin the same version. Diagnostics remain opt-in and do not change login, sharing, rewards, or deployment settings; no schema migration is required. — Thanks @imjlk!

## 0.3.3 — 2026-09-30

### Patch changes

- Updated dependencies: trailbase-client (npm)@1.3.0

## 0.3.2 — 2026-09-28

### Patch changes

- [eb4b23d](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/eb4b23dc3fe6a56016006cf8da5b4c81650af430) Add an optional snapshotMaxRecords guard that rejects oversized collection snapshots before reconciliation. Clarify full replacement versus single-page merging without changing defaults. Add a read-only Bun/Cargo release dependency guard that permits workspace version changes and rejects unrelated lockfile drift before publishing.
  
  Adopt @ait-kit/sdk 0.5.1 with explicit React Native export conditions so consumers can remove their SDK package export patches. — Thanks @imjlk!
- Updated dependencies: trailbase-client (npm)@1.2.0

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

