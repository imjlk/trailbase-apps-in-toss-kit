# @trailbase-apps-in-toss-kit/toss-mtls-client-proxy

## 0.6.4 — 2026-09-22

### Patch changes

- Updated dependencies: trailbase-runtime (npm)@0.5.0

## 0.6.3 — 2026-09-21

### Patch changes

- [07ddf68](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/07ddf68095cb1da754a89aa790751cc1f67cbc0c) Adopt api-core/api-client 0.5.1 for shared promotion failure-text privacy and safe integer recipient validation. Remove the proxy's duplicate recursive redactor so a short recipient equal to a provider error code cannot corrupt that code. Existing v2 ledger schemas remain compatible; fractional or unsafe numeric recipient IDs must be replaced with exact strings before dispatch. — Thanks @imjlk!

## 0.6.2 — 2026-09-20

### Patch changes

- [1107144](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/1107144b94f64ccef1d2a4078dfc4ba359794275) Report promotion v2 execution markers and SUBMITTED outcomes in private ledger diagnostics while retaining read-only, no-retry guidance and compatibility with legacy snapshots. Set the deployment baseline to proxy 0.6.2, including the short-recipient privacy fix, and require the additive v2 ledger migration after legacy reconciliation. End failed migration savepoints before same-connection retries; regression coverage verifies successful retries are committed.
  
  Suppress provider failure text containing short recipient identifiers before returning prepare/execute/status responses, while preserving error codes and correlation keys. Deploy the resulting proxy patch release to obtain this privacy fix. — Thanks @imjlk!
- Updated dependencies: trailbase-runtime (npm)@0.4.1

## 0.6.1 — 2026-09-17

### Patch changes

- [afe5b07](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/afe5b07e62bba5663159204e0ce7a159d7e66080) Address the post-merge review findings on the promotion v2 breaking change.
  
  - **Migration fix (P1) — legacy rows are never adopted**: the v2 key
    store only accepts rows the v2 insert stamped `three-step`; legacy rows
    keyed or keyless stay fenced because both shapes can hide an executed
    grant. `promotion_reward_ledger.v2.sql` wraps its
    statements in a SAVEPOINT — standalone application gets full-transaction
    semantics (interrupted runs roll back and are retryable; apply with
    `sqlite3 --bail ... ".read ..."`), and migration runners that already
    wrap each file in a transaction nest cleanly instead of failing. The
    migration performs **no protocol backfill**: a pending row with a stored
    key and `provider_status = 'PREPARED'` is not provably pre-execution
    (the 0.11 store-key fence admitted `PENDING` too, so an
    executed-then-PENDING row could read `PREPARED` after a same-key store
    replay), and backfilling it would make it v2-claimable and re-executable
    — a double grant. **Drain before upgrading** while the 0.11 helpers
    still run, and drain **every legacy row, keyed or keyless — PREPARED
    included**: keyed rows settle through the status lookup with their
    stored key, and keyless rows require explicit provider/operator
    reconciliation (no status key exists — they may be grants that executed
    before the key was persisted). PREPARED cannot distinguish a
    never-executed key from the executed-then-PENDING replay state — resuming or
    re-adopting either shape can double-grant. The v2 key store now only
    accepts rows the v2 flow itself created (`protocol = 'three-step'` at
    insert), so legacy rows are never adopted, keyed or keyless. The
    migration test covers every legacy row class staying unmarked and
    unclaimable.
  - **Prepare redaction (P2)**: recipient-bound prepare responses now run the
    same provider-echo redaction as execute and status — a get-key rejection
    embedding the submitted `anonKey`/`tossUserKey` in its failure reason no
    longer leaks the raw identifier into logs or persisted error JSON.
  - **Numeric/short recipient redaction (P2)**: whole string/number
    recipient echoes are redacted by equality. Substring redaction applies
    to identifiers of at least 8 characters, or all-digit identifiers of
    at least 10 digits; shorter fragments in free text remain unchanged
    to avoid corrupting unrelated values. Correlation fields
    (`providerTransactionKey`, `providerRequestId`, `checkedAt`) survive
    verbatim. All three promotion endpoints share the same helper.
  - **Docs (P2)**: the anonymous-identity guidance (EN/KO) no longer describes
    the removed proxy-side prepare → execute → status orchestration or
    recommends pre-v2 proxy versions; it now requires the versioned
    `promotion.prepare.v2`/`execute.v2`/`status.v2` capabilities and documents
    caller-owned sequencing. — Thanks @imjlk!

## 0.6.0 — 2026-09-17

### Minor changes

- [860e6e1](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/860e6e1104655a2368c03819e73ea704eef997b5) BREAKING (0.x): standardize new promotion rewards on the persisted three-step contract. Roll out together with a light-on/off switch — merging or publishing alone does not replace a running proxy.
  
  Proxy (pins `@ait-kit/api-core`/`api-client` at 0.5.0):
  
  - The batch `POST /internal/apps-in-toss/promotion/reward/grant` route is removed and answers `410 PROMOTION_GRANT_REMOVED` with zero upstream calls — no grant logic, no redirect, no mixed key-lookup-or-issue behavior. IAP and Smart Message compatibility code is untouched.
  - `prepare` now takes exactly one recipient (`userKey`/`tossUserKey`/`anonKey`) and issues a key bound to it (recipient-less prepares are rejected before dispatch); `execute` requires the persisted key; `status` passes the provider-observed verdict through verbatim — `GRANTED`/`PENDING`/`FAILED`/`NOT_FOUND`/`UNKNOWN` with `checkedAt` observation time and no fabricated `grantedAt` (the UNKNOWN→PENDING remap for legacy ledger consumers is gone; the Rust ledger owns classification).
  - Health capabilities are versioned with the new contract: `promotion.prepare.v2`, `promotion.execute.v2`, `promotion.status.v2`; `promotion.grant` is no longer advertised, so release-doctor preflights requiring the old names fail against this proxy.
  
  Rust (`trailbase-guest-common`):
  
  - `promotion_reward_grant` and its path constant are removed; `promotion_reward_prepare` now takes the recipient payload and rejects anything without exactly one recipient before a network call. `promotion_reward_outcome_from_response` drops the `requested_at` parameter (request time never masquerades as a grant/failure time) and no longer fabricates `GRANTED` from `ok: true` alone — execute verdicts are read from `result` (`SUBMITTED`→pending, `UNKNOWN` stays unknown), and `NOT_FOUND` classifies as failed.
  - Execution facts are persisted separately from provider outcomes: the ledger gains `protocol` (`'three-step'` for new-contract rows, NULL for legacy rows) and a write-once `execution_started_at` recorded atomically in its own committed transaction before the external execute call. Key storage never touches them; PENDING/UNKNOWN outcomes and same-key re-stores can never move a claimed row back to a pre-execution state; `provider_status` stores provider results only.
  - Recovery is one contract: `promotion_reward_ledgers_awaiting_recovery_tx` lists three-step rows whose execution started and whose outcome is unsettled (PENDING/SUBMITTED/UNKNOWN all included), ordered and limited by the execution-start marker — status-only, never prepare/execute, never auto-converting legacy rows. Outcome application keeps its fences (own `provider_request_id`, stored key never swapped, confirmed success/failure sticky).
  - **Migration required for existing installs**: apply `templates/trailbase/sql/promotion_reward_ledger.v2.sql` once (additive `protocol`/`execution_started_at` columns; rows, keys, links, and outcomes preserved; legacy rows stay unmarked). Fresh installs get the columns from the core template. Consumers must rewrite claim handlers that call the removed grant helper; there is no per-request legacy/v2 flag and no dual grant path.
  
  Wire fixtures add execute-`result` (SUBMITTED/UNKNOWN), ok-without-status (pending, never granted), and status-NOT_FOUND cases; the copy-in smoke script runs prepare → execute → status. — Thanks @imjlk!

### Patch changes

- [cc67d97](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/cc67d9727ec5a444295bee76ac6bf6d4af2e54af) Align deployment baselines with the released 0.5.0 image.
  
  - The copy-in Compose template now pins
    `toss-mtls-client-proxy:0.5.0` (was 0.2.0) and its comment describes the
    actual baseline — @ait-kit api-core/api-client 0.4.2 contracts, message
    UNKNOWN outcomes, three-step promotion rewards — instead of the stale
    "API Core 0.2" note. Consumers reconcile their copied Compose file with
    this pin; consumers on older images keep working, but the UNKNOWN outcome
    quarantine in the Rust ledger requires the 0.11.0 guest crates.
  - New bilingual rollout and verification record
    (`docs/en/ait-kit-rollout.md`, `docs/ko/ait-kit-rollout.md`): version
    matrix (proxy 0.5.0 image digest, api 0.4.2 pins, SDK 0.3.0, RN minimum
    2.10.10, crates 0.11.0), rollout order (pause dispatch → proxy →
    capability preflight with minimumVersion 0.5.0 → WASM guests with
    three-step handler adoption → client apps), rollback cautions, the
    2026-09-17 verification record, and the consumer-owned real-device checks
    that remain. No schema migrations ship in this cycle. — Thanks @imjlk!

## 0.5.0 — 2026-09-16

### Minor changes

- [8753a3a](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/8753a3a5fcb762616b9fe3e89bb1caf2ee5377a2) Adopt the published @ait-kit 0.4.2 API contracts and harden the compatibility boundaries.
  
  - `@ait-kit/api-core` and `@ait-kit/api-client` move from exact `0.3.0` pins
    to `0.4.2`. The proxy's public endpoints, legacy wire shapes, and error
    envelopes are unchanged; api-orpc and api-cloudflare-service are still not
    dependencies of this kit.
  - Message outcomes now follow the 0.4 taxonomy end to end: 5xx, empty/HTML
    bodies, conflicting non-failure status aliases, and evidence-free successes
    return `providerStatus: "UNKNOWN"` with the internal
    `error: "INVALID_RESPONSE"` marker passed through next to
    `failureReason`/`providerErrorCode`; 4xx and explicit provider rejections
    stay `FAILED`. 5xx responses keep the caller's `requestedAt` as request-time
    context without claiming a delivery time — the kit's Rust outbox parser
    quarantines UNKNOWN outcomes (see the messages changeset). Two tests that
    encoded the old "5xx = FAILED" assumption now pin the new split with an
    added 4xx case.
  - The plain-HTTP forwarding path (local/test upstreams) now treats 205 like
    204/304 as a null-body response and converts the completed upstream
    response into a fetch `Response` before settling: a conversion failure
    (for example an out-of-range upstream status like 600) surfaces as the
    transport's typed `REQUEST_FAILED` error mapped to the existing 502
    envelope instead of an unhandled throw that strands the caller.
  - IAP evidence handling rides api-core 0.4's strict reads: an
    orderId/status/SKU that is not a real string (including single-element
    arrays) is an `INVALID_RESPONSE`, and query-failure envelopes yield no
    evidence even when a contradictory success payload rides along. The
    payable-order policy is unchanged: no provider SKU evidence or an order-ID
    mismatch still rejects with `UNVERIFIED_IAP_ORDER`.
  - New regressions cover 204/205/304 null bodies, out-of-range statuses,
    UNKNOWN message propagation for empty/HTML/conflicting responses, and the
    strict IAP evidence cases. Promotion prepare/execute/status endpoints,
    login, anonymous-key verification, and stub behavior are unchanged and
    retested. — Thanks @imjlk!

## 0.4.0 — 2026-09-16

### Minor changes

- [f1b6500](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/f1b650044d938aaeab7f1cc12abba7648036ec86) Adopt the shared @ait-kit 0.3 API contracts and Node mTLS transport.
  
  - Pins `@ait-kit/api-core` and `@ait-kit/api-client` to `0.3.0` (exact pins preserved).
  - Replaces the local Node mTLS client with `@ait-kit/api-client/node`: one overall deadline covers DNS, connect, TLS, headers, and the full response body; broken, oversized, or timed-out upstream responses fail closed with the existing `UPSTREAM_*` envelope. Certificate files are still loaded by this repo; only PEM contents cross into the transport.
  - Removes the request-local header rewrites: api-core 0.3 emits the official `x-toss-user-key`/`x-anon-key` recipient headers itself for messages and promotions.
  - Anonymous-key verification now calls `verifyAnonKey` instead of the generic relay; the public `{ok, valid, resultType, mode}` shape and redaction guarantees are unchanged.
  - IAP responses keep the legacy wire shape on top of api-core 0.3's verified/skuCheck contract: payable responses without provider SKU (or naming a different order) still reject with `UNVERIFIED_IAP_ORDER`.
  - Promotions adopt the three-step contract: the legacy grant endpoint preserves its shape (anonymous grants run prepare → execute → status internally), and new `promotion/reward/prepare`, `promotion/reward/execute`, `promotion/reward/status` endpoints let ledger callers persist the transaction key and recover lost execute responses via status. Ledger ownership, idempotency, and concurrency remain TrailBase's responsibility.
  - Server startup, authentication, certificate loading, environment, container config, and health/capability metadata remain in this repository; new capabilities `promotion.prepare` and `promotion.execute` are advertised. — Thanks @imjlk!

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
