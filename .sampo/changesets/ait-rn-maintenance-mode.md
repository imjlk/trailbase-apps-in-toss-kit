---
npm/@trailbase-apps-in-toss-kit/ait-rn: patch
---

Mark `ait-rn` as maintenance mode. It keeps receiving bug, security, SDK 2.x compatibility and migration-continuity fixes, while new client helpers land in `ait-core` and `ait-web` first. Existing RN imports and runtime behavior are unchanged, and no consumer action is required.

To plan a WebView SDK 3 cutover, run `node vendor/trailbase-apps-in-toss-kit/scripts/check-consumer-webview-migration.mjs --root .` from the consumer app and follow `docs/en/webview-migration.md`. The report groups each imported `ait-rn` name as blocked, rewrite, swap-import or review using `data/webview-migration-map.json`; `--strict` (or `CI_STRICT=1`) fails while any RN footprint remains, for use after the RN app is retired. The checker is static analysis only, so device QR checks still decide login, payment, ad and storage continuity.
