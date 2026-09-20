---
npm/@trailbase-apps-in-toss-kit/trailbase-runtime: patch
cargo/trailbase-guest-common: patch
npm/@trailbase-apps-in-toss-kit/toss-mtls-client-proxy: patch
---

Report promotion v2 execution markers and SUBMITTED outcomes in private ledger diagnostics while retaining read-only, no-retry guidance and compatibility with legacy snapshots. Correct the deployment baseline to proxy 0.6.1 and require the additive v2 ledger migration after legacy reconciliation. End failed migration savepoints before same-connection retries; regression coverage verifies successful retries are committed.

Suppress provider failure text containing short recipient identifiers before returning prepare/execute/status responses, while preserving error codes and correlation keys. Deploy the resulting proxy patch release to obtain this privacy fix.
