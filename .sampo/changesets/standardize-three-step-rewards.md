---
cargo/trailbase-guest-common: minor
npm/@trailbase-apps-in-toss-kit/toss-mtls-client-proxy: minor
---

BREAKING (0.x): standardize new promotion rewards on the persisted three-step contract. Roll out together with a light-on/off switch — merging or publishing alone does not replace a running proxy.

Proxy (pins `@ait-kit/api-core`/`api-client` at 0.5.0):

- The batch `POST /internal/apps-in-toss/promotion/reward/grant` route is removed and answers `410 PROMOTION_GRANT_REMOVED` with zero upstream calls — no grant logic, no redirect, no mixed key-lookup-or-issue behavior. IAP and Smart Message compatibility code is untouched.
- `prepare` now takes exactly one recipient (`userKey`/`tossUserKey`/`anonKey`) and issues a key bound to it (recipient-less prepares are rejected before dispatch); `execute` requires the persisted key; `status` passes the provider-observed verdict through verbatim — `GRANTED`/`PENDING`/`FAILED`/`NOT_FOUND`/`UNKNOWN` with `checkedAt` observation time and no fabricated `grantedAt` (the UNKNOWN→PENDING remap for legacy ledger consumers is gone; the Rust ledger owns classification).
- Health capabilities are versioned with the new contract: `promotion.prepare.v2`, `promotion.execute.v2`, `promotion.status.v2`; `promotion.grant` is no longer advertised, so release-doctor preflights requiring the old names fail against this proxy.

Rust (`trailbase-guest-common`):

- `promotion_reward_grant` and its path constant are removed; `promotion_reward_prepare` now takes the recipient payload and rejects anything without exactly one recipient before a network call. `promotion_reward_outcome_from_response` drops the `requested_at` parameter (request time never masquerades as a grant/failure time) and no longer fabricates `GRANTED` from `ok: true` alone — execute verdicts are read from `result` (`SUBMITTED`→pending, `UNKNOWN` stays unknown), and `NOT_FOUND` classifies as failed.
- Execution facts are persisted separately from provider outcomes: the ledger gains `protocol` (`'three-step'` for new-contract rows, NULL for legacy rows) and a write-once `execution_started_at` recorded atomically in its own committed transaction before the external execute call. Key storage never touches them; PENDING/UNKNOWN outcomes and same-key re-stores can never move a claimed row back to a pre-execution state; `provider_status` stores provider results only.
- Recovery is one contract: `promotion_reward_ledgers_awaiting_recovery_tx` lists three-step rows whose execution started and whose outcome is unsettled (PENDING/SUBMITTED/UNKNOWN all included), ordered and limited by the execution-start marker — status-only, never prepare/execute, never auto-converting legacy rows. Outcome application keeps its fences (own `provider_request_id`, stored key never swapped, confirmed success/failure sticky).
- **Migration required for existing installs**: apply `templates/trailbase/sql/promotion_reward_ledger.v2.sql` once (additive `protocol`/`execution_started_at` columns; rows, keys, links, and outcomes preserved; legacy rows stay unmarked). Fresh installs get the columns from the core template. Consumers must rewrite claim handlers that call the removed grant helper; there is no per-request legacy/v2 flag and no dual grant path.

Wire fixtures add execute-`result` (SUBMITTED/UNKNOWN), ok-without-status (pending, never granted), and status-NOT_FOUND cases; the copy-in smoke script runs prepare → execute → status.
