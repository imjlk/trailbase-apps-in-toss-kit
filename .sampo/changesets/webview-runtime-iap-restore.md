---
npm/@trailbase-apps-in-toss-kit/ait-core: minor
npm/@trailbase-apps-in-toss-kit/ait-web: minor
npm/@trailbase-apps-in-toss-kit/ait-rn: patch
---

Close the last WebView gaps in the migration map. `ait-web` adds `runtime` (the same safe operational environment, platform, Toss app version, network and minimum-version helpers as RN, read from the SDK 3 `Environment` and `Device` namespaces instead of the deprecated top-level getters), `diagnostics` (the same opt-in `ait-runtime-diagnostics-v1` snapshot) and `createAppsInTossIapRestoreBridge` in `ait-web/iap`. The restore bridge runs the RN `restorePendingOrders` loop with the same options, results and error codes: it acknowledges an order with `completeProductGrant` only after the backend grant for that order succeeded. `ait-web/ads` re-exports the runtime helpers the same way `ait-rn/ads` does.

The RN runtime helpers, diagnostics collector and IAP restore loop now share their implementation with WebView through `ait-core`. RN exports and behavior are unchanged, except that `isAppsInTossRuntimeSupported` now treats a non-boolean SDK result as unsupported.

Re-run `check-consumer-webview-migration.mjs`: no `ait-rn` import reports as blocked at this revision. Root imports of runtime helpers now resolve to `runtime` through the new `reexportsFrom` map field. At WebView startup, restore pending orders with the same idempotent backend grant the RN bundle used, and confirm purchase and restore on iOS and Android with private QR tests.
