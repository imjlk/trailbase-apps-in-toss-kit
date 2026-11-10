---
npm/@trailbase-apps-in-toss-kit/ait-core: patch
npm/@trailbase-apps-in-toss-kit/ait-web: patch
npm/@trailbase-apps-in-toss-kit/ait-rn: patch
npm/@trailbase-apps-in-toss-kit/toss-mtls-client-proxy: patch
---

Adopt `@ait-kit/sdk` 0.8.0 and `@ait-kit/api-core` / `@ait-kit/api-client` 0.7.0 (exact pins).

- Anonymous key lookups now share one pending SDK call per adapter on RN and WebView. When the Toss app never answers, repeated session reads that hit the kit's 10-second deadline no longer leave a new bridge call behind each time; at most one stays pending. The kit's deadline and error handling are unchanged, and it does not pass the SDK's opt-in `timeoutMs`.
- `ait-web` imports the `createWebView*` factories from `@ait-kit/sdk/webview` instead of the deprecated `@ait-kit/sdk/web` aliases. `createAppsInTossSdkStorageBridge` now types its options as `WebViewStorageOptions`, the same type under its current name. No behaviour changes.
- The proxy's anonymous auth-code exchange route now uses the exchange that `@ait-kit/api-core` provides directly, instead of a local wrapper around the standalone helper. The route path is pinned to `@ait-kit/api-client` `PROXY_ENDPOINTS.anonAuthCodeExchange`, so `TossMtlsHttpClient.anonAuthCodeExchange({ code })` reaches it. The request, the single attempt with no retry, and the response shape are unchanged, and stub mode still returns `FORWARD_MODE_REQUIRED`.
