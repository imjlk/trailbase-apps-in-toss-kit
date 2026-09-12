---
cargo/trailbase-guest-common: minor
npm/@trailbase-apps-in-toss-kit/trailbase-runtime: minor
---

Add explicit per-feature entry, external dispatch, existing-result settlement and
read-only status controls. Missing or stale policies block mutations. Copy the
private operation_policies.sql migration, rebuild WASM and connect checks inside
all handler/worker authorization transactions. Set KIT_OPERATIONS_HOLD=1 outside
the backup before starting a restored database; status lookup remains available.

Add a Release Doctor restore checkpoint check and an old-SQLite-backup rehearsal.
Require an independent durable witness, paused dispatch and reconciled original
transaction IDs before operator resume. The check never sends, grants or resumes
work, and passing supplied evidence does not replace the consumer's durable
write-ahead witness and backup protocol.
