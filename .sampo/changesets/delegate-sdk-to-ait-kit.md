---
npm/@trailbase-apps-in-toss-kit/ait-rn: minor
npm/@trailbase-apps-in-toss-kit/ait-web: minor
---

Delegate common Apps in Toss SDK operations to @ait-kit/sdk instead of reimplementing module acquisition, event settle-once handling, deadline budgets, and cleanup locally. Public imports and signatures are unchanged.

- `ait-rn` (new dependency `@ait-kit/sdk ^0.2.0`): the default (non-injected) login, anonymous-key lookup, full-screen ad load, IAP purchase, and pending-order paths now run on `@ait-kit/sdk/rn` adapters with TrailBase's error taxonomy mapped on top; injected seams (`appLogin`, `getAnonymousKey`, `loadFullScreenAd`, `IAP`) keep the local synchronous flows. New `createAppsInTossSdkStorageBridge()` provides the sdk-backed native storage bridge.
- `ait-web` (new dependency `@ait-kit/sdk ^0.2.0`): `anonymousHash()`, `storage.*`, `createShareLink`, and `share` run on `@ait-kit/sdk/web` adapters behind one memoized SDK load; the `ait:` prefix policy, strict result checks, and appKey namespacing stay local.
- Boundary (documented in `docs/{en,ko}/ait-kit-sdk-delegation.md`): ad show heuristics, IAP product/subscription queries, web login/notification/purchase flows (pinned TrailBase contracts), session bootstrap, legacy-hash migration, and all server callbacks remain TrailBase-owned.
- Consumer-visible default-path changes: RN anonymous-key validation failures now report `ANONYMOUS_KEY_INVALID_RESPONSE` (the local `ANONYMOUS_KEY_ERROR` distinction survives only for injected functions), and default-path RN purchases report grant failures as `IAP_PRODUCT_GRANT_FAILED` (the restore flow keeps `IAP_PRODUCT_GRANT_TIMEOUT`).
- Platform isolation is enforced by new consumer-fixture tests: RN sources never import the web SDK entries and vice versa, and both official SDKs stay optional peers.
