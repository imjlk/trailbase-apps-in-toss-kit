# AIT Contract Rollout and Verification Record

This document records the current Apps in Toss contract baseline for this kit,
the rollout order consumer apps should follow, and the verification evidence
behind the baseline. Versions are distinct release trains: equal-looking
numbers do not imply the same release.

## Version Matrix (0.5.0 baseline, 2026-09-17)

| Component | Version | Notes |
|---|---|---|
| Proxy image | `toss-mtls-client-proxy:0.5.0` | GHCR tags `0.5.0`, `0.5`, `0`, `latest`, `edge`, `sha-729dac6`; digest `sha256:64d31ef5f2671f5e788c45b6ef49cd6d6569a1e4f8ceee149d4b6257b3733148` |
| Proxy internal `@ait-kit/api-core` / `api-client` | `0.4.2` (exact pins) | Message UNKNOWN taxonomy, strict IAP evidence, typed transport failures |
| RN/Web `@ait-kit/sdk` | `0.3.0` (exact pins) | `ait-rn` 0.6.0 / `ait-web` 0.3.0 (private, Sampo-versioned) |
| RN minimum `@apps-in-toss/framework` | `>=2.10.10` | SDK 0.3.0 peer floor; minimum fixture compiles against the same reviewed pin |
| WebView `@apps-in-toss/web-framework` | `>=3.4.0 <4` | Unchanged |
| Rust guest crates | `trailbase-guest-common` / `trailbase-toss-identity` 0.11.0 | Fixed pair; moves together |
| SQL templates | unchanged this cycle | No migrations required; UNKNOWN/execution phases reuse existing columns |

## Rollout Order

No schema migration is required for this baseline. Sequence for consumer
apps:

1. **Pause dispatch first**: stop claiming new promotion and message work,
   and let in-flight attempts finish (message leases expire on their own).
   Old Rust guests convert the new proxy's `UNKNOWN` responses into
   confirmed failures, so the proxy rollout must not overlap live queue
   traffic.
2. **Proxy next**: update the consumer-owned Compose image pin to
   `toss-mtls-client-proxy:0.5.0` (template updated accordingly) and roll the
   proxy. Wire shapes for login, promotion grant, and stub responses are
   unchanged, so a paused worker survives an accidental proxy-first order.
3. **Preflight the proxy before deploying guests**: confirm the health
   metadata check with `minimumVersion: "0.5.0"` and the required
   capabilities `promotion.prepare`, `promotion.execute`,
   `promotion.status`, `contractVersion: 1` (see
   [Release Doctor](release-doctor.md#proxy-capability-preflight)). The
   version floor matters: proxy 0.4.0 already advertises the same
   capabilities but predates the api-core 0.4.2 UNKNOWN-message and
   strict-IAP behavior this rollout activates. Consumers on proxies without
   the prepare/execute capabilities must not silently fall back to the
   legacy grant for new ledger flows.
4. **Rust/WASM guests, with handler adoption**: rebuild guests against
   crates 0.11.0 **and** switch the app's reward handlers to the three-step
   helper sequence — prepare → persist the transaction key → claim → execute
   → apply/status recovery. A rebuild alone changes nothing: the legacy
   grant helper still compiles, and handlers that keep using it retain the
   old lost-response behavior. Deploying the new guests is what makes
   message UNKNOWN outcomes quarantine in the outbox ledger. Deploy guests
   soon after the proxy, and keep dispatch paused until they are live.
5. **Client apps last**: rebuild with `ait-rn` 0.6.0 / `ait-web` 0.3.0
   (`@ait-kit/sdk` 0.3.0). RN consumers must already be on
   `@apps-in-toss/framework >=2.10.10`.
6. **Resume and watch**: re-enable dispatch features and monitor ledger
   outcomes. In-flight promotion attempts and message outbox rows survive
   as-is. Quarantined rows reconcile differently per feature: promotion rows
   (`pending` with `provider_status = 'UNKNOWN'`, or `EXECUTING` after a
   lost execute response) settle through the status lookup with the stored
   transaction key, while message UNKNOWN rows have no kit status endpoint —
   reconcile them explicitly with the provider by `provider_request_id`
   before any deliberate re-enqueue decision (see
   [Functional Messages](functional-messages.md)). Never clear UNKNOWN
   isolation data to "reset" — query and settle it.

### Rollback

- A code rollback cannot cancel rewards the provider already executed.
- No automatic down migrations exist (none were added); ledger/outbox data
  written by the new baseline remains readable by the previous code, except
  that old Rust parsers read `provider_status = 'UNKNOWN'` rows as plain
  failures — preserve and re-apply the new guests before any further
  reconciliation.
- Before rolling back, settle every `EXECUTING` or UNKNOWN promotion row
  through the status lookup with its stored transaction key. Promotion
  executions never expire on their own — only message leases do — so
  waiting leaves a lost execute response in-flight indefinitely, and
  rolling back exposes that row to the old parser as a failure.
- When rolling back, pause new dispatch first, complete the promotion
  reconciliation above (message attempts may instead be left to their lease
  expiry), then roll proxy and guests back together.

## Consumer Impact Summary

- Kit imports, options, and response shapes are unchanged. Raw-JSON
  consumers of the proxy must now expect `providerStatus: "UNKNOWN"` with an
  `error: "INVALID_RESPONSE"` marker on message responses (5xx, empty/HTML
  bodies, conflicting statuses) and treat it as outcome-unknown, not failed.
- Promotion grant/status wire responses keep the legacy shape; the proxy
  maps UNKNOWN to PENDING there for legacy ledger consumers.
- No auto-resend and no auto-regrant exist anywhere in this baseline: unknown
  message outcomes stay out of the dispatch queue, unknown/submitted
  promotions stay pending, and every recovery is an explicit decision — a
  status-lookup with the persisted key for promotions, or provider/operator
  reconciliation by request id for messages (this kit exposes no Smart
  Message status endpoint).

## Verification Record (2026-09-17)

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
  proxy 0.5.0 + guests 0.11.0.
- Real IAP purchase and pending-order restore; confirm server grant gating
  on provider SKU evidence.
- A real promotion reward through prepare → key persistence → execute, plus
  a lost-response recovery via status.
- A real Smart Message send including a partial-delivery outcome, and a
  notification-agreement flow on `@apps-in-toss/framework` 2.10.10.
- Consumer Compose pin and copied template reconciliation against this kit
  version before raising their own supported-version policy.
