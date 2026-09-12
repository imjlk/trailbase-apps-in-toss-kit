---
cargo/trailbase-guest-common: patch
---

Treat an explicit failed promotion response as failed even when it includes a
contradictory success status. Treat a message response without a success flag or
recognized status as UNKNOWN instead of inventing a successful dispatch. Keep
unknown outcomes for reconciliation with the existing request/transaction key;
do not blindly resend or allocate a new promotion key.

Shared synthetic wire fixtures now verify Rust normalizers, proxy compatibility
responses, client transport and ledger diagnostics together. Rebuild consumer WASM
guests to adopt the corrected parsing. No SQL migration or proxy upgrade is required.
