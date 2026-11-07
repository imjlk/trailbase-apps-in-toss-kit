---
npm/@trailbase-apps-in-toss-kit/ait-core: minor
npm/@trailbase-apps-in-toss-kit/ait-web: minor
npm/@trailbase-apps-in-toss-kit/ait-rn: patch
---

Keep the RN account check when stored sessions move to WebView. `ait-web/storage` adds `createAppsInTossWebSessionStorage`, which wraps `ait.storage` with the same guard as the RN session storage. It reads the `${appKey}.appSession`, `${appKey}.tossSession` and `${appKey}.anonymousHash` keys the RN bundle wrote. When the Toss account on the device changed, it clears both sessions and returns null instead of restoring another account's session. The anonymous hash only detects an account change; WebView authentication still exchanges a fresh code. The RN guard now lives in `ait-core` and RN behavior is unchanged. The migration map no longer suggests reading session keys through plain `ait.storage`.

`check-consumer-webview-migration.mjs` now ignores imports inside comments, strings and template literals, and finds imports with comments between their tokens. It reports type-only imports for manual review instead of runtime guidance. It rejects a missing or non-directory `--root` with exit code 2. Unreadable directories, unparsable `package.json` files and source files over 2 MiB are listed as `scanIssues`, and `--strict` fails while any remain. The text report now prints file paths and each module's migration note.
