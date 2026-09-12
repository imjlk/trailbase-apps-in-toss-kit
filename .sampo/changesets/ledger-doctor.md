---
npm/@trailbase-apps-in-toss-kit/trailbase-runtime: minor
cargo/trailbase-guest-common: minor
---

Add a read-only ledger doctor for private SQLite snapshots. Inspect IAP local grant
and completion state, stored subscription projections, original promotion transaction
availability, message attempts and agreement metadata without exposing raw identities,
provider keys, payloads or freeform failures. Recovery output is advisory and requires
a fresh authorized state read before invoking existing shared transition helpers.

Add matching Rust and JavaScript inquiry fingerprints for order, promotion and outbox
record IDs. Return them only from ownership-checked endpoints; they are neither
authorization tokens nor secrets. Diagnostic lookup uses a bounded scan and reports
an incomplete lookup explicitly. Choose the consumer's timestamp unit and use a
consistent private SQLite backup. No schema migration or proxy deployment is required.
