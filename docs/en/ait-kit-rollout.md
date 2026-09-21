# AIT Contract Rollout and Verification Record

This document records the current Apps in Toss contract baseline for this kit,
the rollout order consumer apps should follow, and the verification evidence
behind the baseline. Versions are distinct release trains: equal-looking
numbers do not imply the same release.

## Version Matrix

The 0.5.0 baseline (2026-09-17) established the message-UNKNOWN and
three-step-promotion groundwork; the current cycle is the **promotion v2
breaking release** described below. Pin consumer images to the exact tag of
the release you deploy — never assume two equal-looking version numbers are
the same release train.

| Component | Version | Notes |
|---|---|---|
| Proxy image | `toss-mtls-client-proxy:0.6.3` | Published promotion v2 baseline; require the three versioned promotion capabilities below |
| Proxy internal `@ait-kit/api-core` / `api-client` | `0.5.1` (exact pins) | Message UNKNOWN taxonomy, strict IAP evidence, typed transport failures |
| RN/Web `@ait-kit/sdk` | `0.3.0` (exact pins) | `ait-rn` 0.6.0 / `ait-web` 0.3.0 (private, Sampo-versioned) |
| RN minimum `@apps-in-toss/framework` | `>=2.10.10` | SDK 0.3.0 peer floor; minimum fixture compiles against the same reviewed pin |
| WebView `@apps-in-toss/web-framework` | `>=3.4.0 <4` | Unchanged |
| Rust guest crates | `trailbase-guest-common` / `trailbase-toss-identity` 0.12.2 | Fixed pair; moves together |
| SQL templates | Additive v2 migration required | Apply `promotion_reward_ledger.v2.sql` for existing v1 ledgers; preserve legacy rows |

## Rollout Order

Existing v1 ledgers require the additive v2 migration before new guests run.
Keep dispatch paused throughout reconciliation, migration and deployment:

1. **Pause dispatch first**: stop claiming new promotion and message work,
   and let in-flight attempts finish (message leases expire on their own).
   Old Rust guests convert the new proxy's `UNKNOWN` responses into
   confirmed failures, so the proxy rollout must not overlap live queue
   traffic. Before replacing either proxy or guests, reconcile every legacy
   promotion row while the old stack remains available: query stored keys,
   and use explicit provider/operator reconciliation for keyless rows. Never
   resume PREPARED rows or allocate replacement keys to drain uncertain work.
2. **Proxy next** (breaking promotion v2): update the consumer-owned
   Compose image pin to the released proxy (template updated accordingly;
   final tag comes from the release — this cycle removes the promotion
   grant route) and roll the proxy behind the light-on/off switch. Wire
   shapes for login, messages, IAP, and stub responses are unchanged, but
   `promotion/reward/grant` now answers `410 PROMOTION_GRANT_REMOVED`
   without touching the upstream, prepare requires exactly one recipient,
   and status passes the observed verdict through verbatim (UNKNOWN stays
   UNKNOWN; no PENDING remap). A paused worker survives an accidental
   proxy-first order.
3. **Preflight the proxy before deploying guests**: confirm the health
   metadata check with the released `minimumVersion` and the required
   capabilities `promotion.prepare.v2`, `promotion.execute.v2`,
   `promotion.status.v2`, `contractVersion: 1` (see
   [Release Doctor](release-doctor.md#proxy-capability-preflight)). The
   versioned names matter: pre-v2 proxies advertise the unversioned
   promotion capabilities (and proxy 0.4.0 even those without the
   api-core 0.4.2 UNKNOWN-message and strict-IAP behavior), so a stale
   deployment must fail the preflight instead of passing as this contract.
4. **Verify the legacy drain, migrate the ledger schema, then deploy
   Rust/WASM guests with handler adoption**: confirm the legacy
   promotion ledger was reconciled in step 1 — every legacy row,
   keyed or keyless and PREPARED included, settles through the status
   lookup or explicit reconciliation only (the migration leaves them
   unmarked and v2 never adopts them, so undrained rewards would strand).
   THEN apply
   `templates/trailbase/sql/promotion_reward_ledger.v2.sql` as an explicit
   migration (additive `protocol`/`execution_started_at` columns; legacy
   rows stay unmarked), then rebuild guests against this cycle's crates
   **and** switch the app's reward handlers to the three-step helper
   sequence — insert the pending ledger row (own committed transaction) →
   prepare with one recipient → persist the transaction key (own commit) →
   claim execution by recording `execution_started_at` (own commit) →
   execute → apply/status recovery. A rebuild alone changes nothing, and
   the legacy grant helper no longer compiles: handlers that still call it
   must be rewritten for this cycle. Deploying the new guests is also what
   makes message UNKNOWN outcomes quarantine in the outbox ledger. Deploy
   guests soon after the proxy, and keep dispatch paused until they are
   live.
5. **Client apps last**: rebuild with `ait-rn` 0.6.0 / `ait-web` 0.3.0
   (`@ait-kit/sdk` 0.3.0). RN consumers must already be on
   `@apps-in-toss/framework >=2.10.10`.
6. **Resume and watch**: re-enable dispatch features and monitor ledger
   outcomes. In-flight promotion attempts and message outbox rows survive
   as-is. Quarantined rows reconcile differently per feature: three-step
   promotion rows whose `execution_started_at` is set and whose outcome is
   unsettled (pending, including PENDING/SUBMITTED/UNKNOWN provider
   statuses) come from `promotion_reward_ledgers_awaiting_recovery_tx` and
   settle through the status lookup with their stored key — status only,
   never prepare/execute. Legacy rows without a key need provider/operator
   reconciliation without retrying on a new key (see
   [Promotion Campaigns](promotion-campaigns.md)). Message UNKNOWN rows have
   no kit status endpoint either — reconcile them explicitly with the
   provider by `provider_request_id` before any deliberate re-enqueue
   decision (see [Functional Messages](functional-messages.md)). Never clear
   UNKNOWN isolation data to "reset" — query and settle it.

### Rollback

- A code rollback cannot cancel rewards the provider already executed.
- The v2 migration adds columns; no automatic down migration exists. Keep
  those columns and their execution facts on rollback. Ledger/outbox data
  written by the new baseline remains readable by the previous code, except
  that old Rust parsers read `provider_status = 'UNKNOWN'` rows as plain
  failures — preserve and re-apply the new guests before any further
  reconciliation.
- Before rolling back, drain and settle promotion work while the new guest
  is still live, because older guests cannot resume a persisted transaction
  key:
  - Only v2 rows (`protocol = 'three-step'`) with a stored key and `execution_started_at IS NULL` (key stored,
    execution not started — e.g. dispatch paused right after the key
    commit) must be claimed, executed, and settled now.
  - Rows with `execution_started_at` set and an unsettled outcome settle
    through the status lookup with their stored key.
  - Legacy rows without a key cannot use the status endpoint — they need
    provider/operator reconciliation.
  Promotion executions never expire on their own — only message leases do —
  so waiting leaves a lost execute response in-flight indefinitely, and
  rolling back exposes unsettled rows to the old parser as failures.
- When rolling back, pause new dispatch first, complete the promotion
  reconciliation above (message attempts may instead be left to their lease
  expiry), then roll proxy and guests back together.

## Consumer Impact Summary

- Login/IAP client integration remains unchanged, but the Smart
  Message response contract is additively extended: raw-JSON consumers of
  the proxy can now receive `providerStatus: "UNKNOWN"` plus an
  `error: "INVALID_RESPONSE"` marker on message responses (5xx, empty/HTML
  bodies, conflicting statuses). Exhaustive status validators must accept
  the new value, and every consumer must treat it as outcome-unknown, not
  failed.
- Promotion rewards are a breaking change: the grant route answers `410`
  with no upstream call, prepare is recipient-bound, execute requires the
  persisted key, and status passes the observed verdict through verbatim
  (`GRANTED`/`PENDING`/`FAILED`/`NOT_FOUND`/`UNKNOWN`, `checkedAt`
  observation time, no fabricated `grantedAt`). Raw-JSON promotion
  consumers must handle `NOT_FOUND` and unremapped `UNKNOWN` statuses, and
  the ledger needs the explicit v2 migration (additive columns, legacy rows
  preserved unmarked).
- No auto-resend and no auto-regrant exist anywhere in this baseline: unknown
  message outcomes stay out of the dispatch queue, unknown/submitted
  promotions stay pending, and every recovery is an explicit decision — a
  status-lookup for promotions that hold a persisted transaction key, or
  provider/operator reconciliation by request id for keyless promotions and
  messages (this kit exposes no Smart Message status endpoint).

## Historical Verification Record: proxy 0.5.0 (2026-09-17)

This record covers the previous baseline, not promotion v2. The current baseline
is proxy 0.6.3 and Rust crates 0.12.2 (release PR #147). Verify the v2 migration
and versioned capabilities separately; this historical record is not v2 evidence.

Local checks ran on the feature range `ced5f86..08ae12f` (PRs #133, #134,
#138 — every source change in this baseline). The release merge `729dac6`
added only version bumps, changelogs, and lockfile synchronization; it is
covered by the post-merge main workflows, all of which succeeded. CI rows
refer to the GitHub checks on those PRs, release PR #135, and the
post-release main runs.

| Check | Where | Result |
|---|---|---|
| `bun run packages:typecheck` / `:minimum` | local | pass (minimum fixture `2.10.10`) |
| `bun run packages:test` | local + CI "Test JS packages" | pass (343 tests) |
| `bun test services/toss-mtls-client-proxy` | local + CI "Test proxy" | pass (82 tests) |
| `cargo fmt --all --check` / `clippy -D warnings` / `test --workspace` | local + CI "Test Rust helpers" | pass (165 lib + 17 integration tests) |
| `cargo check --workspace --target wasm32-wasip2` | local + CI | pass |
| `bun run trailbase:wasm:smoke` | local + CI "Run TrailBase WASM integration smoke" | pass |
| `bun run trailbase:functional-ledgers:smoke` | local | pass |
| Image build & push | CI "Build and publish image" on release merge | tags `0.5.0`/`0.5`/`0`/`latest`/`edge`/`sha-729dac6` pushed |
| Health/capability metadata | proxy suite | `promotion.prepare`/`execute`/`status`, `contractVersion: 1` |

Coverage boundaries: all message/promotion/IAP verification used local mock
upstreams, in-memory SQLite, and shared wire fixtures — no real Toss API
calls, no real Toss app, no published-image install test beyond the CI build.

## Remaining Real-Device Checks (consumer-owned)

- Toss app login (production and sandbox referrers) against a deployed
  released proxy + matching guest crates.
- Real IAP purchase and pending-order restore; confirm server grant gating
  on provider SKU evidence.
- A real promotion reward through prepare → key persistence → execute, plus
  a lost-response recovery via status.
- A real Smart Message send including a partial-delivery outcome, and a
  notification-agreement flow on `@apps-in-toss/framework` 2.10.10.
- Consumer Compose pin and copied template reconciliation against this kit
  version before raising their own supported-version policy.
