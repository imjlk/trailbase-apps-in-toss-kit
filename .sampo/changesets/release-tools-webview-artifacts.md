---
npm/@trailbase-apps-in-toss-kit/release-tools: minor
---

`inspectAitArtifact` now inspects WebView SDK 3 artifacts. Pass `webview: true` (or `webview: { entry, requireSourceMaps }`) instead of `expectedBundles`: inspection requires the entry (`sources/index.html` by default) and at least one script under `sources/`, rejects React Native bundles, and checks that each `settingKeys` value appears in some script with the expected value and nowhere with another, in any quote style (bundlers that inline `import.meta.env` may use backticks). Source maps are optional for WebView artifacts unless `requireSourceMaps` is set. `uploadVerifiedAit` re-inspects with the same policy, so WebView uploads need no other change. React Native inspection is unchanged.
