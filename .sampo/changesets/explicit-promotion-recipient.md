---
cargo/trailbase-guest-common: minor
---

Add explicit promotion recipient payload builders for anonymous and Toss Login rewards, requiring a stored transaction key for execute/status requests while preserving the legacy login-only builder. Add a Rust-to-proxy contract test and an opt-in, health-only promotion capability preflight recipe. Before enabling a new caller, verify all three v2 capabilities on the deployed private proxy; older single-call grant callers must migrate before upgrading their proxy. No schema migration or automatic payment retry is introduced.
