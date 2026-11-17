---
npm/@trailbase-apps-in-toss-kit/ait-core: minor
npm/@trailbase-apps-in-toss-kit/ait-web: minor
---

Add `ait-web/back-navigation`: one `backEvent` subscription for the life of a WebView app and a policy that ends every Back press in a visible step. An open sheet or dialog closes first, the first screen closes the app, a sibling tab leads to the first screen, an inner screen goes one screen back, and a screen opened from a deep link closes the app. The platform-neutral policy is `ait-core/back-navigation`.
