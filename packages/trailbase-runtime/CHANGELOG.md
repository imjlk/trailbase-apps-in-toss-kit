# @trailbase-apps-in-toss-kit/trailbase-runtime

## 0.5.0 — 2026-09-22

### Minor changes

- [f103cd4](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/f103cd4ac2c9fe296b79dd7734c2c8fc1e9365c1) Add a read-only owned-currency month-end report CLI with JSON and CSV output.
  Existing databases must apply the forward-only event and policy migrations and
  backfill `owned_currency_policies` before running the report; otherwise the CLI
  fails closed with `REPORT_SCHEMA_UNAVAILABLE`.
  The report quality output also flags missing market-snapshot valuations and
  orphaned conversion groups, and the CLI omits commit provenance for tracked
  dirty checkouts. — Thanks @imjlk!

## 0.4.1 — 2026-09-20

### Patch changes

- [1107144](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/1107144b94f64ccef1d2a4078dfc4ba359794275) Report promotion v2 execution markers and SUBMITTED outcomes in private ledger diagnostics while retaining read-only, no-retry guidance and compatibility with legacy snapshots. Set the deployment baseline to proxy 0.6.2, including the short-recipient privacy fix, and require the additive v2 ledger migration after legacy reconciliation. End failed migration savepoints before same-connection retries; regression coverage verifies successful retries are committed.
  
  Suppress provider failure text containing short recipient identifiers before returning prepare/execute/status responses, while preserving error codes and correlation keys. Deploy the resulting proxy patch release to obtain this privacy fix. — Thanks @imjlk!

## 0.4.0 — 2026-09-12

### Minor changes

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

- [316bf78](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/316bf78805b9222a97366ebe5f01674c5b63f1ab) Keep declared Node CLI entrypoints executable in the source checkout, so frozen
  Bun workspace installation does not alter their tracked file modes before reference
  verification. Direct Node and package-bin invocation behavior is otherwise unchanged. — Thanks @imjlk!

## 0.3.0 — 2026-09-12

### Minor changes

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

## 0.2.6 — 2026-07-09

### Patch changes

- [6a65736](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/6a65736355cbea489e68c1c01967c30f6ca83414) Fix dev runner reruns so ignored same-project containers keep their host ports,
  normal runs do not inherit stale fresh-start tokens, and package lock metadata
  includes all runtime CLI bins. — Thanks @imjlk!

## 0.2.5 — 2026-07-09

### Patch changes

- [2c3e0af](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/2c3e0afb406e2a266c5d98b4fc7086716390f581) Add a copyable template drift mapping example and wire the release doctor
  template to use it when present. — Thanks @imjlk!
- [6d97c87](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/6d97c87b206ab6a2443cda39cfa15bff0b8f4508) Add a copyable release doctor config template for production env, template drift,
  and release-note checks. — Thanks @imjlk!
- [7e1615d](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/7e1615d6b54ff339649e08746cc2ceb2ea0f8796) Add a reusable release doctor for preQA and production handoff checks. The runtime package now exports release-doctor helpers and a CLI that can combine production env validation, app-owned commands, and optional Sampo changeset checks into one normalized result. — Thanks @imjlk!
- [a1e6c8d](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/a1e6c8d29e5e0c138a16fb9734e7b16cd5ad011e) Add a reusable local dev runner plan and CLI wrapper for TrailBase-backed stacks. The runner chooses non-conflicting TrailBase and mTLS proxy host ports, emits generic Compose environment variables, supports dry-run output, and leaves app-owned proxy URL wiring explicit. — Thanks @imjlk!

## 0.2.4 — 2026-06-20

### Patch changes

- [cf5ded4](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/cf5ded486651742a2cb9a360218461f4dd65ec2c) Add shared AppsInToss functional ledger helpers and SQL templates for Smart Message outbox,
  promotion reward grants, and IAP order/grant persistence. — Thanks @imjlk!
- [159fc6d](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/159fc6d6a16d68c59199d6c846270c381975969c) Add an optional TrailBase analytics multi-db template, smoke check, runtime migration copy support
  for database-specific migration directories, and Rust helpers for inserting analytics event batches. — Thanks @imjlk!

## 0.2.3 — 2026-06-16

### Patch changes

- [942e06c](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/942e06c83ddd2018a6fa42b6192e4bb85b0ddab1) Add shared Toss Login unlink callback guards for TrailBase apps. Consumers can validate callback
  Basic Auth and allowed methods through the runtime production checks, use an entrypoint guard in
  production, and derive callback `toss_user_key_hmac` values through `toss_unlink` helpers without
  logging raw Toss user keys. — Thanks @imjlk!

## 0.2.2 — 2026-06-13

### Patch changes

- [7eed7d8](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/7eed7d83af8e08fd13d15d747edee97bca67da8c) Add shared mTLS certificate-pair detection for mounted proxy certificate directories, explicit
  mTLS certificate path validation aligned with proxy certificate precedence, and comment-aware
  scoped consumer template drift checks for larger Compose and env files. — Thanks @imjlk!

## 0.2.1 — 2026-06-05

### Patch changes

- [b52b2e3](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/b52b2e320c1020dfff6d606f728cf01921c154f2) Detect Docker-published host ports when resolving local development ports so
  consumer fresh-start helpers can automatically move to the next available port. — Thanks @imjlk!

## 0.2.0 — 2026-05-22

### Minor changes

- [3395991](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/339599143fcbf386856688c3a0af861e3026c605) Add shared TrailBase runtime helpers, production env validation, local dev port
  resolution, and React Native client adapter utilities for consumer apps.

  This also hardens the shared helpers for reuse across more apps by preserving
  explicit local URL ports, serializing JSON request bodies, passing XHR SSE
  headers, and surfacing XHR SSE HTTP failures as TrailBase errors. — Thanks imjlk!

## 0.1.0

- Initial private runtime helper package.
