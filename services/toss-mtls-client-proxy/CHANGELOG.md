# @trailbase-apps-in-toss-kit/toss-mtls-client-proxy

## 0.3.0 — 2026-09-12

### Minor changes

- [f8f028e](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/f8f028ed9c7cefbd3580a1c47c38f92897d1c75e) Expose additive proxy version and adapter-capability metadata on authenticated health
  responses. Use the Release Doctor proxy-capabilities check before adopting anonymous
  verification, promotion recovery or other new adapter contracts. Legacy health responses
  without metadata require a proxy upgrade or an explicitly optional transitional check.
  
  Pass the internal URL/token through environment variables. Checks use bounded read-only
  health requests, reject redirects and omit secrets/upstream response bodies from reports.
  Capabilities describe this binary, not upstream reachability, configured campaign access
  or user eligibility. No SQL migration is required; publish and select the new proxy image
  before making capability checks mandatory. — Thanks @imjlk!

### Patch changes

- Updated dependencies: trailbase-runtime (npm)@0.4.0

## 0.2.0 — 2026-09-12

### Minor changes

- [cfb560e](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/cfb560e4bb791e8f1e4980ae7a5522d82a54b56f) Verify Apps in Toss anonymous keys through the private proxy before bootstrap,
  retaining the existing HMAC of ait:<hash> and canonical TrailBase user flow.
  Add verified-key sealing, private identity storage, explicit message recipients,
  and anonymous promotion grants/status lookup with request-local header adaptation.
  
  Apply anonymous_identities.sql, the one-time message_outbox_recipients migration,
  and optional promotion_reward_recipients.sql as new consumer migrations. Stop
  legacy dispatch workers before enabling anonymous rows, preserve notification
  agreement checks for both recipient types, and deploy the next proxy image before
  using verification or anonymous promotion. Existing login rows remain unchanged.
  Consumer real-app/sandbox validation is still required before production rollout.
  
  Normalize anonymous enqueue identifiers before persistence so whitespace cannot
  bypass idempotency or break exact notification-template agreement lookup.
  
  Strip raw recipient fields from both login and anonymous outbox payloads before
  persistence, including nested context. Scrub any existing raw recipient fields
  through a consumer-owned data migration; idempotent retries preserve historical rows. — Thanks @imjlk!
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

## 0.1.12 — 2026-07-01

### Patch changes

- [9f6967c](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/9f6967cc0288d548c137c1ae890ff2478b759ebb) Switch the mTLS proxy to consume the public `@ait-kit/api-core` and `@ait-kit/api-client` packages while preserving the existing HTTP API and certificate boundary. — Thanks @imjlk!
- [5e2cd84](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/5e2cd84cd8353170865e08825b7c3024c314673d) Remove the proxy-local Toss Login unlink error wrapper and rely on `@ait-kit/api-core` normalization while preserving the proxy HTTP contract. — Thanks @imjlk!

## 0.1.11 — 2026-06-29

### Patch changes

- [609f263](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/609f2634460878c629136a265f4b113450240369) Extract the Toss mTLS adapter logic behind private runtime-neutral core and HTTP client workspace packages, align the core mTLS port with the `request(url, init) => Response` shape, and preserve the proxy HTTP API, Docker image behavior, and certificate boundary. — Thanks @imjlk!

## 0.1.10 — 2026-06-29

### Patch changes

- [08fd8e2](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/08fd8e2b50dc58e35b626239db2e191326567db0) Add graceful shutdown handling for the mTLS proxy, enable init and a request-safe stop grace period in
  the reusable Compose template, and document how to preserve in-flight Toss requests during container
  recreates. The proxy now closes idle keep-alive sockets during shutdown so idle clients do not consume
  the full grace period. — Thanks @imjlk!

## 0.1.9 — 2026-06-16

### Patch changes

- [2e9f71b](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/2e9f71b5cc3d5ef01cf989a5b24e5915adf4cff3) Require Toss Login AccessToken forwarding for the remove-by-user-key proxy adapter and treat
  top-level Toss error bodies as unlink failures. The adapter still keeps the internal proxy bearer
  token separate from Toss upstream authorization and does not echo raw user keys or access tokens.
  The Rust guest helper now requires the Toss Login AccessToken argument so consumers cannot call the
  unlink adapter without the upstream credential required by Toss. The proxy complete adapter also
  returns backend-only token metadata so proxy-mode consumers have a supported path for service-side
  unlink without bypassing the adapter. — Thanks @imjlk!

## 0.1.8 — 2026-06-16

### Patch changes

- [4c7fa37](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/4c7fa37c6cee245e02cf51f5d5b63163ae09f175) Add `--health-only`, `--full`, and expected-mode checks to the reusable Toss mTLS proxy smoke
  script. The default mode now verifies forward proxy health for production pre-QA, while full adapter
  payload smoke tests stay available only for local stub environments via `--full`. — Thanks @imjlk!

## 0.1.7 — 2026-06-16

### Patch changes

- [be480a6](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/be480a604107776c5a798ac78098aa95caf04fa9) Add a dedicated Toss Login remove-by-user-key proxy adapter and Rust helper. Consumer WASM guests no
  longer need to call the generic mTLS relay with the official Toss path, and the proxy normalizes
  unlink responses without echoing raw Toss user keys. — Thanks @imjlk!

## 0.1.6 — 2026-06-08

### Patch changes

- [480b382](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/480b3829d7ba6c3094c860bb37970762ddcbb061) Add an internal AppsInToss smart-message bulk adapter for
  `send-bulk-message`, enforce the 2,500 recipient limit, and expose matching
  Rust proxy helpers for TrailBase jobs. Treat non-2xx upstream smart-message
  responses as failed dispatches instead of inferring success from missing Toss
  result fields. — Thanks @imjlk!

## 0.1.5 — 2026-06-05

### Patch changes

- [ce52936](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/ce52936566a16c340b749944cbaed3bacb8ec79c) Normalize AppsInToss smart-message responses around official `resultType`, delivery counts, detail,
  failure, and reach-failure fields, and add shared functional-message helpers plus SQL/docs templates
  for template registry, SDK notification agreement tracking, and reusable outbox provider summaries.
  The message `templateSetCode` and notification agreement SDK `templateCode` are stored separately so
  consumer apps can gate user-requested functional alerts before dispatching through the proxy. — Thanks @imjlk!
- [a0a1d3f](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/a0a1d3f2107c84908598dbe1a139d5b8e344044d) Update the reusable Toss mTLS proxy smoke template to exercise Toss login,
  promotion reward grants, and smart-message dispatch, matching the current
  AppsInToss operational paths used by consumer apps. — Thanks @imjlk!

## 0.1.4 — 2026-05-22

### Patch changes

- Allow AppsInToss promotion reward requests to provide per-request campaign
  codes and amounts, and surface provider error codes so consumers can pause or
  exhaust DB-backed campaigns safely.

## 0.1.3 — 2026-05-18

### Patch changes

- [91cd21b](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/91cd21b40d12fc12c0b65776eb9494079e011c72) Retry transient Apps in Toss IAP order-status responses and preserve the requested SKU when Toss omits it. — Thanks @imjlk!

## 0.1.2 — 2026-05-16

### Patch changes

- Auto-detect a single Toss Console mTLS certificate pair named `*_public.crt` and `*_private.key`
  from the mounted certificate directory before falling back to explicit path env vars.

## 0.1.1 — 2026-05-11

### Patch changes

- Harden the mTLS proxy runtime validation, request limits, upstream timeout handling, and operator
  documentation.
