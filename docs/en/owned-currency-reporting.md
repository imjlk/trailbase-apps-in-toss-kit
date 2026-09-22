# Owned Currency Reporting

Apps may keep their current reward and balance implementations while recording
accounting facts in a shared, private journal. This template is intended for
the month-end reporting requested for self-issued currency promotions. It does
not classify a promotion for Apps in Toss and it does not submit a report to
the Toss console.

## What the kit provides

Copy both `templates/trailbase/sql/owned_currency_events.sql` and
`templates/trailbase/sql/owned_currency_policies.sql` into forward-only
consumer migrations. The `owned_currency_events` table is a private journal
of signed integer minor units. The `owned_currency_policies` table keeps the
valuation mode, denomination, rational rate, and effective window for each
policy version. Populate a policy row before writing events that reference its
version; existing consumers must add this migration and backfill the policy
history they can support before running the report CLI. Updating the kit
submodule does not update migrations copied into a consumer app.

Keep the table out of the public Record API. The optional `_user` reference is
set to `NULL` when a user is deleted, so a later closed-period aggregate does
not retain the TrailBase identity. `source_id` and `metadata_json` must remain
opaque and must not contain raw Toss user keys, HMACs, sealed values, tokens, or
secrets.

The journal is not a balance projection. Existing app-owned balances remain
app-owned. A grant in `app_reward_grants` is still the app credit, and a row in
`promotion_reward_ledger` still records a Toss provider grant. If either one is
also mirrored into this journal, use a stable source and idempotency key so the
same credit is not counted twice.

## Event rules

`ISSUE` and `CONVERT_IN` use positive quantities. `SPEND`, `CONVERT_OUT`,
`EXCHANGE`, and `EXPIRE` use negative quantities. `ADJUSTMENT` may be positive
or negative and must point to an operator-approved source record. A conversion
uses the same `conversion_group_id` on its input and output rows; the output is
not another issuance. An exchange uses an `exchange_id`; its reservation and
Toss provider state belong in a separate exchange table and the existing
promotion ledger.

Conversion and exchange identifiers must be non-empty and already trimmed. Treat
them as stable join keys; do not normalize them differently in separate adapters.

Store grams, points, and other fractional values as integer minor units with an
explicit `unit_code`. Store valuation as an integer amount and capture the
`policy_version` that produced it. Do not recalculate historical value from a
current exchange rate or market price.

`idempotency_key` is globally unique within the journal. Prefix it with the app,
source, and source-event scope rather than assuming that a user-local key is
unique. The source check query still catches the same source action recorded
under different idempotency keys.

## SQL Editor examples

The read-only examples in
`templates/trailbase/sql-editor/owned-currency-report.sql` cover:

- a half-open monthly summary (the `period_start` literal is inclusive and the
  `period_end` literal is exclusive);
- balance as of a timestamp;
- policy-version breakdown with recorded valuation denominations; and
- policy-window mismatches where an event falls outside its recorded policy's
  effective interval; and
- duplicate source detection that ignores only a validated `CONVERT_IN`/`CONVERT_OUT` pair;
- missing `MARKET_SNAPSHOT` valuation observations; and
- orphaned conversion groups at an as-of cutoff.

Replace the two timestamp literals at the top of each query with values in the
unit used by the consumer database. The examples are for an authenticated
operator/admin SQL Editor session and should be run against a consistent
database snapshot when preparing a report.

```sql
-- Example parameters for a millisecond database:
-- Replace 1788192000000 with the inclusive period start.
-- Replace 1790870400000 with the exclusive period end.
```

The queries intentionally report issued quantity separately from current
balance. A month with 10,000 units issued and 6,000 units exchanged still has
10,000 units of issuance in the report.

## Read-only report CLI

The runtime package also includes `trailbase-owned-currency-report`. It reads a
consistent SQLite snapshot without writing to it and emits either redacted JSON
or CSV. The snapshot must contain both `owned_currency_events` and
`owned_currency_policies`.

```bash
bun vendor/trailbase-apps-in-toss-kit/packages/trailbase-runtime/bin/owned-currency-report.mjs \
  --db path/to/trailbase.sqlite \
  --period-start 1788192000000 \
  --period-end 1790870400000 \
  --timestamp-unit milliseconds \
  --format json
```

Use `--format csv` for a spreadsheet or submission worksheet. The output keeps
issuance, consumption, conversion, exchange, valuation denominations, and
as-of balances separate; it does not include source IDs or user identifiers.
CSV period rows retain the policy valuation mode, rational conversion rate, and
effective window. The quality section also counts events whose policy version
is missing, whose event time falls outside that policy version's effective
window, missing `MARKET_SNAPSHOT` valuation observations, and orphaned
conversion groups at the report cutoff. An exchange under a `NONE` policy
does not require a valuation observation. CSV output includes those quality
counts as a final `quality` row and records the period, timestamp unit,
generation time, and CLI provenance in a `metadata` row. If tracked files in
the checkout are modified, the CLI omits `sourceCommit` rather than claiming
the report came from the committed `HEAD`.
`trailbase-ledger-doctor` remains the diagnostic tool for the existing payment
ledgers. Neither command submits data to Toss or changes the live database.

## Close manifest and approval evidence

Keep a separate JSON close manifest beside the report. Copy
`templates/trailbase/release/owned-currency-close-manifest.example.json` and
replace its example values. The manifest records the manifest and report schema
versions, app id, half-open period, timestamp unit, timezone, SHA-256 of the
exact report bytes, a private snapshot reference, source commit, report tool
version, policy versions, approval revision, and an ordered prefix of close
records:

The close-manifest validator binds the JSON report output byte-for-byte. Keep
CSV as a human worksheet/export; validate the JSON artifact as the manifest's
report.

```text
GENERATED → REVIEWED → SUBMITTED
```

`SUBMITTED` means that an operator recorded a submission; it does not assert
that Toss accepted or approved the report. Each recorded stage needs its own
timestamp and private evidence reference. A correction creates a new
`reportRevision` and points `correctionOf` at the previous revision; existing
manifests and event rows are retained. The manifest contains no user ids, Toss
identifiers, promotion codes, credentials, or report file paths.

Validate the manifest against the report bytes before a release handoff. The
runtime helper rejects hash, period, timestamp-unit, source, policy, stage-order,
and evidence-reference mismatches without writing to the database. A Release
Doctor configuration can add this optional check:

```json
{
  "type": "owned-currency-close-manifest",
  "name": "Owned currency close evidence",
  "manifest": "apps/trailbase/reports/2026-09.manifest.json",
  "report": "apps/trailbase/reports/2026-09.json",
  "required": false
}
```

The report and manifest paths belong to the Release Doctor configuration, not
the manifest itself. Keep the check optional during adoption and make it
required only after the consumer app has an operator-owned approval workflow.

## Month-end workflow

1. Confirm the app adapter has recorded all source events and policy versions.
2. Run the SQL Editor summary against a consistent snapshot.
3. Check conversion groups, exchange states, unknown provider outcomes, and
   duplicate source IDs.
4. Save the JSON report and its close manifest after operator review.
5. Record corrections as new adjustment events or a new report revision; do not
   rewrite old event rows.

Valuation totals stay grouped by `valuation_currency_code`; never add integer
amounts from different denominations into one total. The first version is deliberately read-only. It does not infer missing history
from a balance, call the Toss provider, or enforce a fixed monthly budget. The
consumer app must confirm the applicable reporting period, valuation rule, and
retention policy with Toss before submitting an official report.
