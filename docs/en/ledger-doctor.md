# Private Ledger Diagnostics

The ledger doctor inspects a private SQLite snapshot without issuing writes or
calling Toss. It reports **stored** provider/ledger state, not the provider's current
state. Use it for a support inquiry before choosing a recovery action. Bun 1.4.2
is the kit's pinned runtime; the CLI uses [Bun SQLite](https://bun.com/docs/runtime/sqlite)
with a read-only connection, query-only mode, and a consistent read transaction.

```bash
bun vendor/trailbase-apps-in-toss-kit/packages/trailbase-runtime/bin/ledger-doctor.mjs \
  --db /private/backups/main.sqlite --kind iap --record-id "$ORDER_ID" \
  --timestamp-unit milliseconds --server-version 0.33.14 --json
```

Use a consistent SQLite backup produced by the database/consumer backup procedure.
Do not copy only the main file of a live WAL database and assume it includes recent
transactions. Keep the snapshot and its access private. The tool does not acquire
production credentials, fetch a backup, create tables, run migrations, or contact
an API. Table names follow the kit defaults; custom consumer schemas need adapters.

Supported kinds and recorded details:

| Kind | Details | Possible next checks |
| --- | --- | --- |
| `iap` | Local grant, completion confirmation, refund, stored subscription flags | Verify order, confirm an existing grant, reconcile subscription events |
| `promotion` | Status and whether the original transaction key exists | Query that transaction; missing key requires manual reconciliation |
| `message` | Recipient kind, push/inbox counts, latest attempt, lease, agreement metadata | Inspect expired unsent claims or reconcile uncertain dispatch without resending |

Message templates and consent tables are optional inspection capabilities. Their
absence appears as unavailable metadata; it never grants dispatch permission.
Subscription projections are likewise recorded facts, never access authorization.
Always use the existing shared owner checks, notification gate and ledger helpers
when the consumer actually reads entitlements or performs a side effect.

The timestamp unit is mandatory because copied consumers own their clock contract.
Choose `seconds` or `milliseconds` to match the database. `observedAt` is the tool's
inspection time in that unit. Future update times are marked as clock skew; unsafe
numeric values are withheld. `tool.sourceCommit` identifies this tool checkout,
and `reportedServerVersion` is operator-supplied metadata, not a detected server
version or a statement about the snapshot's provenance.

## Inquiry IDs

An authenticated backend can return a stable fingerprint for an owned ledger row:

```rust
use trailbase_guest_common::ledger_diagnostics::{ledger_diagnostic_id, LedgerKind};
let diagnostic_id = ledger_diagnostic_id(LedgerKind::Iap, &owned_order.order_id)?;
// Return diagnostic_id only after the endpoint has checked the caller's ownership.
```

JS backends can import `createLedgerDiagnosticId` from
`@trailbase-apps-in-toss-kit/trailbase-runtime/ledger-doctor`. The wire format is
`kitdiag1.<kind>.<sha256>`, hashing UTF-8 `kit-ledger-diagnostic-v1\0<kind>\0<record-id>`.
The identifier must be a valid UTF-8 ledger primary key of at most 512 bytes without
surrounding whitespace, control characters or BOM. Use `order_id` for IAP and the
ledger `id` for messages/promotions. Never pass a Toss user key, HMAC or sealed value.
Fingerprints are not secrets, authorization tokens, or proof of payment.

Operators can inspect an inquiry using the fingerprint alone:

```bash
bun vendor/trailbase-apps-in-toss-kit/packages/trailbase-runtime/bin/ledger-doctor.mjs \
  --db /private/backups/main.sqlite --kind message --diagnostic-id "$DIAGNOSTIC_ID" \
  --timestamp-unit milliseconds --scan-limit 10000
```

Fingerprint lookup scans only primary keys, up to the explicit limit (default
10,000; maximum 100,000). If the match is outside the inspected range, the tool
returns `DIAGNOSTIC_LOOKUP_LIMIT_REACHED`, not “record absent.” Use an authorized
direct record-ID lookup for larger ledgers or add a consumer-owned indexed mapping.
No diagnostic-ID mapping table or migration is required by this kit.

## Output and Recovery Boundary

Text and JSON output omit raw user identifiers, primary record IDs, provider
transaction keys, payloads, HMACs, sealed values and freeform failure messages.
Known statuses, timestamps, counts, presence flags and the fingerprint remain.
Unexpected provider statuses become `UNRECOGNIZED`. Use protected app tooling to
investigate omitted failure detail; do not copy raw database rows into support logs.

Every `recoveryPlan` is non-executable. It records expected status/update time and,
for messages, attempt number, with `requiresFreshRead: true`. A snapshot may become
stale immediately. Re-read current state inside an authorized transaction and use
the existing attempt/owner guards before calling a shared transition helper.
The CLI has no `--apply` mode and never supplies a command that blindly regrants,
allocates a new promotion key, or resends an uncertain message.

Exit codes: 0 for a report, 1 when the record is absent from a complete lookup,
2 for invalid input, unavailable schema, incomplete lookup or inspection failure.
Missing optional tables are different from an incompatible required ledger schema.
No public endpoint, server callback, schema migration or proxy rollout is added.
See [Release Doctor](release-doctor.md) for deployment checks and
[functional messages](functional-messages.md), [IAP orders](iap-orders.md) and
[promotion campaigns](promotion-campaigns.md) for the actual transition contracts.
