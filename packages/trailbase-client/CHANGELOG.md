# @trailbase-apps-in-toss-kit/trailbase-client

## 1.1.1 — 2026-09-13

### Patch changes

- [a704fca](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/a704fcabbc348006e4b29b772a7741f77687c793) Accept the official TrailBase 0.14 record API as the RN XHR SSE fallback without requiring it to implement the adapter's AbortSignal option. Cancellation remains handled by the XHR adapter and collection lifecycle; no app-local type cast is needed when upgrading the SDK. — Thanks @imjlk!

## 1.1.0 — 2026-09-12

### Minor changes

- [c6148b0](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/c6148b04685014fc460dee3c63c8926d11781a4a) Add an optional account lifecycle that clears user caches and subscriptions,
  isolates query keys by principal and session revision, ignores stale callbacks,
  and refreshes backend entitlements and pending work before exposing a ready session.
  On app foreground, revalidate the existing session instead of trusting cached SDK
  subscription status. Disconnection clears local session credentials; server unlink,
  revocation and anonymous-to-canonical data merge remain consumer responsibilities.
  
  Session manager operations now supersede earlier operations, pass AbortSignal to
  backend callbacks, and serialize storage writes so delayed responses cannot restore
  an old account. Handle StaleAppSessionOperationError as cancellation, use one manager
  per storage namespace, and route auth transitions through the lifecycle when adopted.
  No SQL migration or proxy rollout is required.
  Multi-key writes share one queue slot, and a persistent writePending marker blocks
  restoration of partially written credentials. Keep the marker with the session
  namespace and handle AppSessionStorageIncompleteError with clear/sign-in recovery.
  Preserve stored credentials on transient restore/foreground failures; provide
  isInvalidSessionError for custom authoritative revocation errors. Disconnect still
  attempts credential deletion when resource cleanup fails, and explicit anonymous
  bootstrap cannot make a partially written Toss mirror valid again. — Thanks @imjlk!
- [6fb1b82](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/6fb1b82e781c75e95af6cd6968f26c73f61cb609) Recover TanStack collections after SSE disconnects using complete paginated
  snapshots, deletion reconciliation, and queued events with react-db 0.3.8. Set
  snapshotMode to merge for partial lists; the default now treats limit as page size.
  
  Add optional message dispatch leases with attempt fencing and quarantine uncertain
  in-flight sends instead of resending them. Apply message_outbox_attempts.sql as a
  new consumer migration and stop legacy workers before adopting leased APIs. Rust
  message responses now include channel failure details and content identifiers.
  
  Record local IAP grant and Toss completion separately. Existing completion history
  is preserved; newly granted rows need explicit confirmation. Query promotion
  results with the persisted transaction key through the new status endpoint; missing
  keys require reconciliation rather than a new grant. Deploy the next proxy image
  before using that endpoint. No minimum TrailBase server change is required.
  
  Make XHR SSE connection setup abortable during cleanup and bound header resolution
  and response-header waits with a configurable 15-second connection deadline. — Thanks @imjlk!

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

## 1.0.0 — 2026-06-23

### Major changes

- [409294a](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/409294a5a3accb8c60966e5f9560ff07941840d8) Remove the `trailbase-client/analytics` public surface and keep the shared analytics router, buffered sink, sanitizer, backend batch client, and AppsInToss SDK bridge under `ait-rn/analytics`. The deprecated notification agreement helper has also been removed from `trailbase-client/apps-in-toss`; React Native consumers should use `ait-rn/notifications`. — Thanks @imjlk!

### Patch changes

- [4d4f631](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/4d4f6318e34e95013ba59dd20e9db9337bcb8e74) Expose package metadata for consumer build tools and avoid shipping literal AppsInToss test ad group IDs in production bundles. — Thanks @imjlk!
- [487edd0](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/487edd0a78a4b5c10de869367201d84af5441213) Increase the default buffered analytics flush interval to 30 seconds so consumers send fewer sparse detail analytics batches by default. — Thanks @imjlk!

## 0.5.1 — 2026-06-20

### Patch changes

- [1f53594](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/1f535944e6d7e3c6d0416bedc7e640e03bb49faa) Fix the buffered analytics sink return path so strict consumer TypeScript
  projects can typecheck the shared source package. — Thanks @imjlk!

## 0.5.0 — 2026-06-20

### Minor changes

- [9f7cda2](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/9f7cda2e8cac8ea1d4fb43ee6c2aa9971e266b8f) Add bootstrap-controlled analytics sink helpers for AppsInToss metric logging, plus a framework-typed `ait-rn/analytics` bridge. — Thanks @imjlk!

## 0.4.2 — 2026-06-19

### Patch changes

- [24695d2](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/24695d2cfcd7efa40b804dc432543255f9e93754) Add React Native Apps in Toss notification agreement, functional-message backend,
  and promotion campaign claim helpers. Keep the default promotion claim result to
  public campaign status fields while allowing apps to supply their own
  `normalizeResponse` for internal/admin projections. Mark the older TrailBase
  client notification agreement helper as deprecated for compatibility. — Thanks @imjlk!

## 0.4.1 — 2026-06-16

### Patch changes

- [a2f2362](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/a2f2362bb8ea239b218a6d21457dfa9c00902296) Add an Apps in Toss Storage-backed `KeyValueStorage` adapter for React Native and WebView mini-apps.
  Consumers can inject the official `Storage` bridge for production session persistence while keeping
  memory or localStorage fallbacks limited to local tests. — Thanks @imjlk!

## 0.4.0 — 2026-06-09

### Minor changes

- [2ee561a](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/2ee561a09675477a9cc97d9677a71bf90cc62f50) Add a configurable analytics router for TrailBase detailed analytics and AppsInToss console analytics integration. — Thanks @imjlk!

### Patch changes

- [07da898](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/07da8988ad6037bd0507dc02d6050d3fa7496f68) Add a dedicated AppsInToss client adapter subpath and normalize notification
  agreement SDK results for TrailBase functional-message consent storage without
  forwarding raw SDK event payloads. — Thanks @imjlk!

## 0.3.1 — 2026-06-08

### Patch changes

- [a3435c6](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/a3435c629c976c652cf29c2b5953f8b520eb54d0) Preserve the AppsInToss SDK-provided sandbox referrer casing when normalizing
  Toss Login results so backend proxy and forward flows can exchange the original
  one-time authorization code reliably. — Thanks @imjlk!

## 0.3.0 — 2026-06-05

### Minor changes

- [6971577](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/69715775ffe171cf83dbbe41a6f36c6b938154df) Add shared Toss identity store helpers, configurable unlink callback parsing/auth, DB-backed promotion campaign utilities with explicit env fallback control, and Apps in Toss login adapter/error normalization helpers. — Thanks @imjlk!
- [8c58212](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/8c582121a121cfcfa9abed3436d95c77f39ff5dc) Expose TanStack React DB primitives from the TrailBase client adapter and keep
  the React DB runtime dependency pinned inside the kit for submodule consumers. — Thanks @imjlk!

## 0.2.0 — 2026-05-22

### Minor changes

- [3395991](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/339599143fcbf386856688c3a0af861e3026c605) Add shared TrailBase runtime helpers, production env validation, local dev port
  resolution, and React Native client adapter utilities for consumer apps.

  This also hardens the shared helpers for reuse across more apps by preserving
  explicit local URL ports, serializing JSON request bodies, passing XHR SSE
  headers, and surfacing XHR SSE HTTP failures as TrailBase errors. — Thanks imjlk!

## 0.1.0

- Initial private TrailBase client helper package.
