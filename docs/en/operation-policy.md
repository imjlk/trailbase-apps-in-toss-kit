# Pause, settle and rehearse a restore

Copy `templates/trailbase/sql/operation_policies.sql` into a new private migration
and rebuild the WASM guest. `operation_policy::require_operation_tx` controls each
of `iap`, `promotion`, `smart-message` and `app-reward` separately. A missing row,
expired policy, future update time or malformed flag cannot enable mutations.
Read policy in the transaction that authorizes the work; client UI state is advisory.
Authentication, disabled-principal checks and domain eligibility still apply.

| Phase | Use |
| --- | --- |
| `Entry` | Start a new purchase, reward attempt or message request |
| `Dispatch` | Authorize an outbound grant, send or retry with side effects |
| `Settlement` | Apply an already verified result to local inventory/entitlements |
| `Status` | Read-only receipt/provider status lookup; never sends or grants |

For example, disabling entry and dispatch while allowing settlement lets already
verified purchases finish. Disable settlement too when restored local history is
uncertain. A status read remains possible without a policy row or during a hold.
This is not permission to resend a pending message or promotion.

```rust,ignore
use trailbase_guest_common::operation_policy::{require_operation_tx, OperationFeature, OperationPhase};
// In the SAME transaction as the existing message dispatch-permit helper:
require_operation_tx(&mut tx, OperationFeature::SmartMessage, OperationPhase::Dispatch)?;
// begin_message_outbox_dispatch_tx(...), then commit, then send.
```

Use `Iap/Settlement` immediately before the existing idempotent inventory grant,
`Promotion/Dispatch` before acquiring a provider grant permit, and
`AppReward/Entry` or `AppReward/Settlement` inside the offer/claim policies.
`SmartMessage/Entry` gates new outbox rows and `SmartMessage/Dispatch` gates sends.
Set `KIT_OPERATION_POLICIES_ENABLED=1` after applying the migration to enable the
built-in guards in `mark_iap_order_granted_tx`, `enqueue_message_outbox_tx`,
`claim_ready_message_outbox_tx`, `begin_message_outbox_dispatch_tx` and
`insert_promotion_reward_ledger_tx`. `operation_policy_integration()` reports this
configured state and the exact guarded helpers for a private startup diagnostic.
The external hold overrides those boundaries even without that opt-in flag.
Consumer-owned SDK entry points, direct promotion sends and custom inventory paths
still need an explicit guard. The SQL alone does not intercept existing apps.
`require_operation_tx` reads authoritative database time internally; callers cannot
supply a stale timestamp to extend a policy. `OPERATION_HELD` distinguishes the
external override from `OPERATION_PAUSED` for a missing/stale/disabled policy.
Roll back denied transactions. Never hold a database transaction over network I/O.
A pause cannot revoke already committed dispatch permits or cancel in-flight calls;
stop/drain workers and reconcile those original attempts before declaring quiescence.

An operator update should compare the expected revision and increase it, set server
`updated_at`, and give the flags a deliberate expiry. Check exactly one row changed:

```sql
UPDATE operation_policies
SET revision = revision + 1, allow_entry = 0, allow_dispatch = 0,
    allow_settlement = 1, updated_at = :now, expires_at = :expiry
WHERE feature = 'iap' AND revision = :expected_revision;
```

Initial rows need an explicit operator insert. Do not auto-enable features at
startup or let stale cached policy overwrite a newer revision. Keep operator audit
records private and exclude user keys, HMACs and ciphertext.

## External restore hold

Before **any** API or worker process opens a restored database, set
`KIT_OPERATIONS_HOLD=1` in its deployment environment outside the backup. Every
`require_operation_tx` mutation check respects this override before reading the
restored policies. `0`, `false` or absence selects normal per-feature policy;
other nonempty values keep the hold active. The example env file defaults to held.
An old backup containing enabled feature rows must never bypass this startup hold.
Consumers must apply the guard to all side-effect paths, including background jobs.


For TrailBase WASM, host environment variables are not automatically inherited by
the sandbox. Render these string settings into a private `/settings.json` in a
separately mounted read-only root and pass `--runtime-root-fs /run/kit-runtime` to
TrailBase. Keep that root outside restored data and verify
`operation_policy_integration()` reports enabled/held as expected before traffic.
`settings.json` is cached per guest instance: restart all API/worker instances when
changing the external hold or opt-in setting. A host `-e` flag alone is insufficient.
See `templates/trailbase/runtime/operation-settings.example.json`.

## Old-backup rehearsal and release evidence

`trailbase-runtime/restore-checkpoint` exports `evaluateRestoreCheckpoint` and a
programmatic `createRestoreCheckpointCheck` for Release Doctor. It compares a
private database checkpoint with an **independent durable write-ahead witness**,
and requires paused dispatch plus zero reported in-flight and unresolved outcomes.
The check makes no provider calls, writes no data and never resumes operations.
Its passing result validates the supplied evidence; it is not proof that an app
implemented every guard or recorded every external effect.

The consumer owns both readers and this protocol:

1. Keep a durable append-only witness outside the backup boundary. Record each
   dispatch intent with its original request/transaction identity **before** the
   external effect. Retain enough private evidence for original-ID reconciliation.
   A checkpoint copied from the same backup is not an independent witness.
2. Serialize checkpoint progression, using a stable history `generation` and
   monotonic safe-integer `sequence`. Commit the matching DB checkpoint only with
   the related local ledger state. A crash between stores must leave a detectable
   gap; do not reset generation/sequence to make the comparison pass.
3. Boot the restored DB under the external hold, stop/drain dispatchers and compare
   both checkpoints. Missing witnesses, history gaps and unknown outcomes block
   readiness. A restored PENDING/READY row may already have caused an external effect.
4. Quarantine uncertain work. Reconcile original provider IDs/transaction keys and
   restore the local outcome and checkpoint transactionally. Never blindly resend,
   allocate new provider keys, or mark unknown work successful merely to clear a check.
   If provider lookup is unavailable, retain the quarantine for manual resolution.
5. Rerun the check with trusted private readers. Keep the hold until an operator
   explicitly accepts the evidence, applies fresh feature revisions and resumes.

```js
import { createRestoreCheckpointCheck } from './vendor/trailbase-apps-in-toss-kit/packages/trailbase-runtime/src/restore-checkpoint.mjs';
// Add this programmatic check to runReleaseDoctor({ checks: [...] }).
const check = createRestoreCheckpointCheck({ readEvidence: readPrivateRestoreEvidence });
// readEvidence returns { database: { generation, sequence }, witness: { generation, sequence },
//   dispatchPaused: true, inFlight: 0, unresolved: 0 }, from actual private sources.
```

Run `bun test packages/trailbase-runtime/test/restore-checkpoint.test.mjs`. The
rehearsal copies a real SQLite file before a synthetic send, persists external
witness/provider state in a separate SQLite file, reopens the old backup, blocks a
second send and reconciles the original ID. The final provider call count remains
one. Pair this with per-feature gate tests and the app's own backup/worker protocol.
Archive only redacted results and version/backup references, never private IDs or logs.

Run `KIT_SMOKE_OPERATIONS_HOLD=1 bun run trailbase:wasm:smoke` as well as the default smoke to validate mounted settings and real WASM gates in both modes.
