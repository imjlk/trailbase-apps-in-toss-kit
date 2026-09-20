# trailbase-guest-common

## 0.12.1 — 2026-09-17

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

## 0.12.0 — 2026-09-17

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

## 0.11.0 — 2026-09-16

### Minor changes

- [a89e2b0](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/a89e2b08b350517d204767c125b95efc1ffd53f7) Persist promotion transaction keys before executing rewards.
  
  - New three-step proxy helpers: `promotion_reward_prepare` (issues a key and
    nothing else — no recipient fields), `promotion_reward_execute` (rejects a
    payload without a transaction key before any network call), joining the
    existing `promotion_reward_status` lookup. The legacy grant helper stays.
  - New ledger helpers complete the recommended flow on the existing schema
    (no new tables, columns, or migrations): `store_promotion_transaction_key_tx`
    persists the key and marks the row `PREPARED` (same-key re-store is
    idempotent; a different key is rejected with
    `PROMOTION_TRANSACTION_KEY_CONFLICT` and an existing key is never
    overwritten), `begin_promotion_reward_execute_tx` atomically claims
    `PREPARED` → `EXECUTING` so exactly one worker can execute (concurrent and
    restart-after-claim callers get `None`; terminal rows are never re-entered),
    and `promotion_reward_ledgers_awaiting_recovery_tx` lists rows whose execute
    started but whose outcome is unknown — recovery is a status lookup with the
    stored key first, never an immediate re-execute.
  - Outcome application now only matches the ledger row's own
    `provider_request_id` (another request's response returns
    `PROMOTION_REWARD_REQUEST_MISMATCH` instead of being absorbed) and never
    overwrites a stored key with a different one. A confirmed `success` row
    still cannot be reverted by a late pending/unknown response.
  - `SUBMITTED` (execute accepted, unconfirmed) now normalizes onto the pending
    taxonomy, and `UNKNOWN` survives `ok:false` envelopes: both keep the ledger
    row `pending` with no fabricated `granted_at`/`failed_at` — neither a
    confirmed grant nor a confirmed failure. Execution progress is tracked in
    `provider_status` (`PENDING` → `PREPARED` → `EXECUTING`), distinguishing
    "key stored, execution not started" (safe to claim and execute with the
    stored key after a restart) from "execution started, outcome unknown"
    (status lookup first).
  - Shared wire fixtures gain `execute-submitted` and `execute-unknown`
    promotion cases; SQL-level tests execute the real statements against the
    template schema (single-claim, key immutability, request-id fencing,
    restart resume, recovery listing, late-response protection, outcome
    taxonomy). Operation policy keeps result queries allowed while new grants
    are paused. Ops docs describe the full flow in English and Korean. — Thanks @imjlk!
- [4d4a970](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/4d4a97084e1315e7cf46348d4d2554eecd7d8c45) Preserve unknown Smart Message delivery outcomes through ledger completion.
  
  - `normalize_provider_status` no longer collapses `providerStatus: "UNKNOWN"`
    into a confirmed failure when the proxy envelope reports `ok:false` (broken
    body, timeout, uninterpretable response). `ok` describes the call envelope;
    `ok:true` alone still never confirms a send. Explicit failures and the
    conflicting `ok:false` + `SENT` shape still classify as FAILED, and empty or
    unparseable responses keep parsing as UNKNOWN.
  - Completion now records three distinct outcomes in the existing schema (no
    new states or tables): confirmed send (`SENT` + `sent_at`), confirmed
    failure (`FAILED` + `failed_at`), and unknown outcome — outbox
    `status = 'FAILED'` only to exclude the row from the dispatch queue, with
    `provider_status = 'UNKNOWN'` and `status = 'UNKNOWN'` on the matching
    attempt row, matching the lease-expiry quarantine model. No `sent_at` or
    `failed_at` is fabricated for an unknown outcome; `updated_at` records the
    observation time and the internal envelope error stays in `failure_reason`,
    distinct from `providerErrorCode`.
  - Unknown rows are never auto-requeued: the ready claim skips them and
    lease-expiry recovery leaves them untouched. Late responses stay fenced, so
    a late UNKNOWN cannot revert a confirmed SENT. Operators reconcile unknown
    outcomes explicitly (for example by provider request id) before any manual
    re-enqueue.
  - Shared wire fixtures gain an `unknown-envelope` message case
    (`ok:false` + `providerStatus:"UNKNOWN"` + internal `error`), asserted by
    the Rust, proxy, runtime, and RN contract tests. — Thanks @imjlk!

## 0.10.0 — 2026-09-12

### Minor changes

- [e6d6104](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/e6d6104d6274e03a29d773ab61a842574c1c5ee1) Add server-issued app-owned AD/SHARE reward attempts, mandatory server offer and
  eligibility policies, owner/placement-scoped receipt lookup and atomic once-only
  local credits. SDK events and attempt IDs are not server evidence of viewing or
  sharing; consumers must supply an explicit eligibility and quota policy.
  
  Copy app_reward_attempts.sql as a new private migration and rebuild WASM guests.
  A grant ledger row is the credit itself: keep optional balance projections in the
  same transaction and never issue an external payment after committing it. Preserve
  receipt lookup during pauses and reconcile lost responses with the original ID.
  These helpers do not manage platform-paid rewards or Toss promotion payments. — Thanks @imjlk!
- [c3a5e91](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/c3a5e91a7450036fe2e7008c93c199a8ea77d09c) Add explicit per-feature entry, external dispatch, existing-result settlement and
  read-only status controls. Missing or stale policies block mutations. Copy the
  private operation_policies.sql migration, rebuild WASM and connect checks inside
  all handler/worker authorization transactions. Enable the built-in IAP grant,
  message enqueue/dispatch and promotion entry guards with
  KIT_OPERATION_POLICIES_ENABLED=1; inspect operation_policy_integration() at startup.
  Policy expiry uses database time internally. Set KIT_OPERATIONS_HOLD=1 outside
  the backup before starting a restored database; status lookup remains available.
  
  Add a Release Doctor restore checkpoint check and an old-SQLite-backup rehearsal.
  Require an independent durable witness, paused dispatch and reconciled original
  transaction IDs before operator resume. The check never sends, grants or resumes
  work, and passing supplied evidence does not replace the consumer's durable
  write-ahead witness and backup protocol. — Thanks @imjlk!

### Patch changes

- [1bcc37f](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/1bcc37f38dc8be64e510dd1ca60c441cb5e355ff) Treat an explicit failed promotion response as failed even when it includes a
  contradictory success status. Treat a message response without a success flag or
  recognized status as UNKNOWN instead of inventing a successful dispatch. Keep
  unknown outcomes for reconciliation with the existing request/transaction key;
  do not blindly resend or allocate a new promotion key.
  
  Shared synthetic wire fixtures now verify Rust normalizers, proxy compatibility
  responses, client transport and ledger diagnostics together. Rebuild consumer WASM
  guests to adopt the corrected parsing. No SQL migration or proxy upgrade is required. — Thanks @imjlk!

## 0.9.0 — 2026-09-12

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
- [ae4382f](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/ae4382f25c4d7ea15d8dccef5e0da6cf847682f0) Upgrade trailbase-wasm to 0.6.1 and verify the 0.33.14 server with an isolated
  component/auth/Record API/SSE integration smoke. Rebuild all consumer components
  and coordinate the server/guest rollout; new binaries do not support pre-0.32
  hosts. Update the first-party auth-ui component separately.
  
  Fix anonymous bootstrap and password rotation for the post-0.31.2 _user schema,
  which replaced verified with unverified_email. Existing flag-based schemas remain
  supported by the SQL helpers; verified principals and pending email changes are
  preserved. Official auth endpoints still issue tokens. The last verified server
  moves to 0.33.14; the manual kit minimum stays TBD. Consumer production/device and
  full migration checks remain required before rollout.
  
  Trigger runtime smoke checks on client/parser dependency changes and verify the
  read-only Record API ACL with valid auth, CSRF and a complete record payload. — Thanks @imjlk!
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
- [928f347](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/928f3478c76c655ee1dbee9887068d5f951c59dc) Add a read-only ledger doctor for private SQLite snapshots. Inspect IAP local grant
  and completion state, stored subscription projections, original promotion transaction
  availability, message attempts and agreement metadata without exposing raw identities,
  provider keys, payloads or freeform failures. Recovery output is advisory and requires
  a fresh authorized state read before invoking existing shared transition helpers.
  
  Add matching Rust and JavaScript inquiry fingerprints for order, promotion and outbox
  record IDs. Return them only from ownership-checked endpoints; they are neither
  authorization tokens nor secrets. Diagnostic lookup uses a bounded scan and reports
  an incomplete lookup explicitly. Choose the consumer's timestamp unit and use a
  consistent private SQLite backup. No schema migration or proxy deployment is required. — Thanks @imjlk!

## 0.8.1 — 2026-06-21

### Patch changes

- [3aef7a7](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/3aef7a7871f6617e7a88856a9cec9eb2671e76f3) Avoid redundant TrailBase auth password-hash work when ensuring existing anonymous auth users during bootstrap. — Thanks @imjlk!

## 0.8.0 — 2026-06-21

### Minor changes

- [0f2f3e8](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/0f2f3e842479f6609cb3060733cce7e2f05f4020) Add a batch insert helper and app-owned SQL template for low-volume domain
  events, while documenting the boundary from high-volume analytics mirrors. — Thanks @imjlk!
- [8ae5b9f](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/8ae5b9fd010069567a71eb226667679cffb1e770) Optimize Smart Message outbox claiming to lock a ready batch with one update,
  preserve claim order, and document bulk dispatch grouping for functional message
  jobs. — Thanks @imjlk!
- [2bcd15e](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/2bcd15e1f49bb6c48bcc90cc793e3c8f1feb6c29) Add the recommended `analytics.events` table helper and SQL template, keep the
  legacy `analytics.analytics_events` path compatible, and optimize analytics
  batch insert helpers to reuse table validation and insert SQL per batch. — Thanks @imjlk!

## 0.7.0 — 2026-06-20

### Minor changes

- [cf5ded4](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/cf5ded486651742a2cb9a360218461f4dd65ec2c) Add shared AppsInToss functional ledger helpers and SQL templates for Smart Message outbox,
  promotion reward grants, and IAP order/grant persistence. — Thanks @imjlk!
- [159fc6d](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/159fc6d6a16d68c59199d6c846270c381975969c) Add an optional TrailBase analytics multi-db template, smoke check, runtime migration copy support
  for database-specific migration directories, and Rust helpers for inserting analytics event batches. — Thanks @imjlk!

## 0.6.0 — 2026-06-19

### Minor changes

- [8724a22](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/8724a22b6665e9dea5c01869283c1a2a8e3a279f) Add AppsInToss IAP bridge helpers, app-owned grant client utilities, and Rust
  order-status normalization helpers for TrailBase guest ledgers. — Thanks @imjlk!

## 0.5.0 — 2026-06-16

### Minor changes

- [2e9f71b](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/2e9f71b5cc3d5ef01cf989a5b24e5915adf4cff3) Require Toss Login AccessToken forwarding for the remove-by-user-key proxy adapter and treat
  top-level Toss error bodies as unlink failures. The adapter still keeps the internal proxy bearer
  token separate from Toss upstream authorization and does not echo raw user keys or access tokens.
  The Rust guest helper now requires the Toss Login AccessToken argument so consumers cannot call the
  unlink adapter without the upstream credential required by Toss. The proxy complete adapter also
  returns backend-only token metadata so proxy-mode consumers have a supported path for service-side
  unlink without bypassing the adapter. — Thanks @imjlk!

## 0.4.1 — 2026-06-16

### Patch changes

- [be480a6](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/be480a604107776c5a798ac78098aa95caf04fa9) Add a dedicated Toss Login remove-by-user-key proxy adapter and Rust helper. Consumer WASM guests no
  longer need to call the generic mTLS relay with the official Toss path, and the proxy normalizes
  unlink responses without echoing raw Toss user keys. — Thanks @imjlk!
- [942e06c](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/942e06c83ddd2018a6fa42b6192e4bb85b0ddab1) Add shared Toss Login unlink callback guards for TrailBase apps. Consumers can validate callback
  Basic Auth and allowed methods through the runtime production checks, use an entrypoint guard in
  production, and derive callback `toss_user_key_hmac` values through `toss_unlink` helpers without
  logging raw Toss user keys. — Thanks @imjlk!

## 0.4.0 — 2026-06-08

### Minor changes

- [8e5851c](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/8e5851c6be1db2f16778304fa0023eb289ab05ce) Generalize functional notification agreement storage around `template_code`,
  rename the dispatch gate fields to notification-specific names, and keep
  message-template consent keys normalized across current and legacy SQL schemas. — Thanks @imjlk!
- [e79fc6a](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/e79fc6a607e8f9f17a2ae7c1847027a656779bb1) Add generic TrailBase domain event helpers for app-owned event history tables,
  including safe SQL identifier validation, insert/list statement builders, and
  schema guidance that keeps server-side ledgers separate from AppsInToss
  Analytics. — Thanks @imjlk!

### Patch changes

- [2121078](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/212107855e79e2a575cdbf341ebf1775dac38eb3) Add a shared Toss Login sandbox stub decision helper and document that real
  AppsInToss sandbox `authorizationCode` values should be exchanged through the
  configured proxy or forward path instead of being treated as local stubs.
  Only explicit stub mode or simulator-only `dev-*` authorization codes should
  activate local fallback behavior. — Thanks @imjlk!
- [480b382](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/480b3829d7ba6c3094c860bb37970762ddcbb061) Add an internal AppsInToss smart-message bulk adapter for
  `send-bulk-message`, enforce the 2,500 recipient limit, and expose matching
  Rust proxy helpers for TrailBase jobs. Treat non-2xx upstream smart-message
  responses as failed dispatches instead of inferring success from missing Toss
  result fields. — Thanks @imjlk!

## 0.3.0 — 2026-06-05

### Minor changes

- [6971577](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/69715775ffe171cf83dbbe41a6f36c6b938154df) Add shared Toss identity store helpers, configurable unlink callback parsing/auth, DB-backed promotion campaign utilities with explicit env fallback control, and Apps in Toss login adapter/error normalization helpers. — Thanks @imjlk!
- [5b9339e](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/5b9339e79313ad6ed0572456f2c9a3750e26cfc7) Preserve the existing active TrailBase `_user` as canonical when upserting a Toss identity for a
  different anonymous `_user`, and return the canonical user from the shared helper. — Thanks @imjlk!
- [350be3e](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/350be3e65429dd3c07621f4e1206184f04cbf162) Add optional TrailBase anonymous auth hardening helpers for synthetic credential rotation,
  canonical anonymous-user aliases, and coarse bootstrap attempt limits, plus SQL templates and docs
  for profile auth state and bootstrap protection. — Thanks @imjlk!
- [ee8e837](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/ee8e837d0fd10e29b7398d4330a2b3bdffd852d5) Add shared promotion reward helpers for fixed and capped grant amounts, generic provider payloads,
  provider outcome normalization, amount-aware campaign availability checks, and adapter-based reward
  usage queries. — Thanks @imjlk!

### Patch changes

- [ce52936](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/ce52936566a16c340b749944cbaed3bacb8ec79c) Normalize AppsInToss smart-message responses around official `resultType`, delivery counts, detail,
  failure, and reach-failure fields, and add shared functional-message helpers plus SQL/docs templates
  for template registry, SDK notification agreement tracking, and reusable outbox provider summaries.
  The message `templateSetCode` and notification agreement SDK `templateCode` are stored separately so
  consumer apps can gate user-requested functional alerts before dispatching through the proxy. — Thanks @imjlk!
- [85059c3](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/85059c39784e0eb97a57ef31f09adc453752a8d2) Fix promotion reward failure timestamps, stabilize Apps in Toss upstream snapshot output, and
  document DB-backed promotion campaign activation requirements. — Thanks @imjlk!
- [fcbc9a7](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/fcbc9a7ce04b4dffc21f5707b292821547b0398e) Separate functional Smart Message `templateSetCode` from the notification agreement SDK
  `templateCode`, add a shared helper for persisting `requestNotificationAgreement` results, and
  gate user-requested functional alerts against the stored agreement code before dispatch. — Thanks @imjlk!

## 0.2.0 — 2026-05-18

### Minor changes

- [997c979](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/997c9799fcb496f27fa65b52208eda2fe8c31504) Add shared Apps in Toss direct login helpers for generating access tokens and reading user keys. — Thanks @imjlk!

## 0.1.4 — 2026-05-16

### Patch changes

- Versioned with the shared Toss identity helper crate.

## 0.1.3 — 2026-05-11

### Patch changes

- Add shared AppsInToss proxy adapter helpers for promotion rewards and smart messages.

## 0.1.2 — 2026-05-11

### Patch changes

- Add shared AppsInToss proxy helpers for Toss login, IAP order status, and proxy failure messages.

## 0.1.1 — 2026-05-11

### Patch changes

- Add shared TrailBase guest helpers for API responses, settings, database access, and session handling.
