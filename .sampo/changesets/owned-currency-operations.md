---
cargo/trailbase-guest-common: minor
npm/@trailbase-apps-in-toss-kit/trailbase-runtime: minor
---

Add transaction-scoped currency recording with policy and exact replay checks,
private source/balance reconciliation, and snapshot-only close artifact generation.
Consumers must wire original ledgers and private adapter views. Refunds are adjustments,
not issuance; only confirmed exchanges are EXCHANGE. No automatic approval or submission.

Validate live policy valuations and full-length source keys, reconcile conversion groups, and publish close manifests atomically only after the period ends. Consumer expected-event views must expose nullable conversion_group_id.
