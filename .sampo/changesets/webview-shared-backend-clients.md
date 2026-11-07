---
npm/@trailbase-apps-in-toss-kit/ait-core: minor
npm/@trailbase-apps-in-toss-kit/ait-web: minor
npm/@trailbase-apps-in-toss-kit/ait-rn: patch
---

Share the remaining platform-neutral RN helpers with WebView through `ait-core`. `ait-web` adds `notifications` (functional message client and agreement result normalization), `iap` (backend grant client and `AppsInTossIapBridgeError`), `promotion`, `share` (an SDK 3 share-link bridge with the same deep-link, OG image and message behavior as RN) and `shopping`; `ait-web/ads` now includes the inline ad placeholder policy. RN imports, error class identities and runtime behavior are unchanged, and `ait-rn/share` additionally re-exports the shared `createShareBridge` factory.

Consumers updating to this revision must keep `vendor/trailbase-apps-in-toss-kit/packages/ait-core` registered in their Bun workspaces and regenerate their lockfile. Re-run `check-consumer-webview-migration.mjs`: these names now report as swap-import. The remaining WebView gaps are the runtime environment helpers, the diagnostics collector and the IAP pending-order restore flow. Device QR checks still decide share-sheet, shopping-link and purchase behavior.
