# @trailbase-apps-in-toss-kit/ait-rn

## 0.4.1 — 2026-09-13

### Patch changes

- Updated dependencies: trailbase-client (npm)@1.1.1

## 0.4.0 — 2026-09-12

### Minor changes

- [415decc](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/415decc0e44105d490767017e13137c20efd5a6d) Add RN subscription purchase and status-query bridges with per-API support checks,
  subscription identifiers, renewal cycles and offers, while retaining one-time
  purchase/restore behavior and older injected SDK support for existing methods.
  
  Add a private subscription webhook inbox and per-order entitlement projection.
  Apply iap_subscriptions.sql after the order ledger as a new consumer migration.
  Authenticate webhook ingress in the consumer, map renewal orders authoritatively,
  and configure provider-local timestamp conversion explicitly. Duplicate/older
  events cannot overwrite current state; equal-time conflicts require reconciliation.
  Client SDK status never independently authorizes server benefits. Subscription
  sandbox testing is unavailable, so validate the feature in the real Toss app
  before consumer rollout. The proxy remains internal and outbound-only.
  
  Prevent failed or fallback-only lookups from reserving new order IDs, and require
  verified order state when applying or reading subscription entitlements. Handle
  UNVERIFIED_IAP_ORDER for lookups that cannot establish a new owner mapping. Normalize
  offer fields consistently and reject unsupported explicit registration versions. — Thanks @imjlk!

### Patch changes

- [12324f9](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/12324f91cad34dfad078d72ec7d7e7f471ecbccb) Refresh the RN SDK reference to 2.10.10, pin Bun 1.4.2, and check adapter sources
  against the installed SDK types in CI. Upgrade the proxy to @ait-kit 0.2.0 while
  preserving authenticated generic mTLS requests, the documented Smart Message
  recipient header, and legacy partial-delivery failure fields. Anonymous message
  requests use x-anon-key exclusively; consumers still enforce notification agreement.
  
  The Compose template keeps the already released proxy 0.1.12 as a baseline; that
  image does not contain these source changes. After the next Sampo-generated proxy
  image is published, update the consumer-owned image pin before using the new behavior.
  No TrailBase schema migration or minimum supported server change is required.
  
  Forward IAP lookups no longer promote requested SKUs into provider evidence. Paid
  responses without a provider SKU fail with UNVERIFIED_IAP_ORDER; retry verification
  before granting products. Explicit stub mode remains available for local tests. — Thanks @imjlk!
- Updated dependencies: trailbase-client (npm)@1.1.0

## 0.3.2 — 2026-06-23

### Patch changes

- [409294a](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/409294a5a3accb8c60966e5f9560ff07941840d8) Remove the `trailbase-client/analytics` public surface and keep the shared analytics router, buffered sink, sanitizer, backend batch client, and AppsInToss SDK bridge under `ait-rn/analytics`. The deprecated notification agreement helper has also been removed from `trailbase-client/apps-in-toss`; React Native consumers should use `ait-rn/notifications`. — Thanks @imjlk!
- [4d4f631](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/4d4f6318e34e95013ba59dd20e9db9337bcb8e74) Expose package metadata for consumer build tools and avoid shipping literal AppsInToss test ad group IDs in production bundles. — Thanks @imjlk!
- [487edd0](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/487edd0a78a4b5c10de869367201d84af5441213) Increase the default buffered analytics flush interval to 30 seconds so consumers send fewer sparse detail analytics batches by default. — Thanks @imjlk!
- Updated dependencies: trailbase-client (npm)@1.0.0

## 0.3.1 — 2026-06-20

### Patch changes

- Updated dependencies: trailbase-client (npm)@0.5.1

## 0.3.0 — 2026-06-20

### Minor changes

- [9f7cda2](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/9f7cda2e8cac8ea1d4fb43ee6c2aa9971e266b8f) Add bootstrap-controlled analytics sink helpers for AppsInToss metric logging, plus a framework-typed `ait-rn/analytics` bridge. — Thanks @imjlk!

### Patch changes

- Updated dependencies: trailbase-client (npm)@0.5.0

## 0.2.0 — 2026-06-19

### Minor changes

- [24695d2](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/24695d2cfcd7efa40b804dc432543255f9e93754) Add React Native Apps in Toss notification agreement, functional-message backend,
  and promotion campaign claim helpers. Keep the default promotion claim result to
  public campaign status fields while allowing apps to supply their own
  `normalizeResponse` for internal/admin projections. Mark the older TrailBase
  client notification agreement helper as deprecated for compatibility. — Thanks @imjlk!
- [e03ac94](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/e03ac94886a5bef8f37eddd23d2ff79881f5a554) Add AppsInToss ad follow-up helpers for official test ad group IDs, app-owned rewarded ad claim clients, and RN inline ad support/placeholder decisions. — Thanks @imjlk!
- [70fc965](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/70fc9653cb7d35290c687e19451586e89ea40779) Add AppsInToss contactsViral share reward bridge helpers with event
  normalization, cleanup, timeout, and unsupported-runtime handling. — Thanks @imjlk!
- [eb19b05](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/eb19b05bff32d6f2d85e8feadbcec932e6fb5e43) Add shared AppsInToss runtime guards and internal bridge primitives for React
  Native SDK callback adapters. — Thanks @imjlk!
- [8724a22](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/8724a22b6665e9dea5c01869283c1a2a8e3a279f) Add AppsInToss IAP bridge helpers, app-owned grant client utilities, and Rust
  order-status normalization helpers for TrailBase guest ledgers. — Thanks @imjlk!

### Patch changes

- Updated dependencies: trailbase-client (npm)@0.4.2

## 0.1.0 — 2026-06-18

### Minor changes

- [6571865](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/65718653ef83d60d511bfbca91caae12966f3984) Add React Native Apps in Toss full-screen ad and share bridge helpers, plus
  public subpath exports for the ait-rn utility modules. — Thanks @imjlk!
- [5e21e20](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/5e21e206067d69507177c6f81fa6cacb3fbd60be) Add React Native Apps in Toss SDK bridge helpers that resolve stable `getAnonymousKey` identities for TrailBase consumer apps. — Thanks @imjlk!
- [823b042](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/823b04298b2b1592b725fd8baee9674ed9e10061) Add reusable React Native Apps in Toss session storage, login bridge, haptic fallback, and persistent JSON storage helpers for consumer app bootstrap code. — Thanks @imjlk!

