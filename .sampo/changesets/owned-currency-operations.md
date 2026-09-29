---
cargo/trailbase-guest-common: minor
npm/@trailbase-apps-in-toss-kit/trailbase-runtime: minor
---

Add transaction-scoped currency recording with policy and exact replay checks,
private source/balance reconciliation, and snapshot-only close artifact generation.
Consumers must wire original ledgers and private adapter views. Refunds are adjustments,
not issuance; only confirmed exchanges are EXCHANGE. No automatic approval or submission.
