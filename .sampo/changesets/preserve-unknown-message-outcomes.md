---
cargo/trailbase-guest-common: minor
---

Preserve unknown Smart Message delivery outcomes through ledger completion.

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
  the Rust, proxy, runtime, and RN contract tests.
