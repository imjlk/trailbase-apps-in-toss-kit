---
cargo/trailbase-guest-common: minor
---

Persist promotion transaction keys before executing rewards.

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
  are paused. Ops docs describe the full flow in English and Korean.
