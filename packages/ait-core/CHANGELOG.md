# @trailbase-apps-in-toss-kit/ait-core

## 0.3.3 — 2026-11-12

### Patch changes

- [6eeaf07](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/6eeaf07be866588c4c200c3cfa360d52e0ce0d50) Add an opt-in interstitial completion policy that retains SDK callbacks until dismissal for server-verified ad receipts. — Thanks @imjlk!

## 0.3.2 — 2026-11-10

### Patch changes

- [91e1902](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/91e190221dc297c205d1f6722c7a3861fe5851d3) Keep promotion response normalization compatible with source consumers that enable
  `noUncheckedIndexedAccess`. Explicitly narrow the selected non-success status
  without changing provider outcomes or weakening conflicting-response validation. — Thanks @imjlk!

## 0.3.1 — 2026-11-10

### Patch changes

- [c478963](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/c4789634d19b35989723f711fd0c244bb20603c9) Adopt `@ait-kit/sdk` 0.8.0 and `@ait-kit/api-core` / `@ait-kit/api-client` 0.7.0 (exact pins).
  
  - Anonymous key lookups now share one pending SDK call per adapter on RN and WebView. When the Toss app never answers, repeated session reads that hit the kit's 10-second deadline no longer leave a new bridge call behind each time; at most one stays pending. The kit's deadline and error handling are unchanged, and it does not pass the SDK's opt-in `timeoutMs`.
  - `ait-web` imports the `createWebView*` factories from `@ait-kit/sdk/webview` instead of the deprecated `@ait-kit/sdk/web` aliases. `createAppsInTossSdkStorageBridge` now types its options as `WebViewStorageOptions`, the same type under its current name. No behaviour changes.
  - The proxy's anonymous auth-code exchange route now uses the exchange that `@ait-kit/api-core` provides directly, instead of a local wrapper around the standalone helper. The route path is pinned to `@ait-kit/api-client` `PROXY_ENDPOINTS.anonAuthCodeExchange`, so `TossMtlsHttpClient.anonAuthCodeExchange({ code })` reaches it. The request, the single attempt with no retry, and the response shape are unchanged, and stub mode still returns `FORWARD_MODE_REQUIRED`. — Thanks @imjlk!

## 0.3.0 — 2026-11-09

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

## 0.2.0 — 2026-11-05

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

