---
npm/@trailbase-apps-in-toss-kit/toss-mtls-client-proxy: patch
cargo/trailbase-guest-common: minor
---

Require Toss Login AccessToken forwarding for the remove-by-user-key proxy adapter and treat
top-level Toss error bodies as unlink failures. The adapter still keeps the internal proxy bearer
token separate from Toss upstream authorization and does not echo raw user keys or access tokens.
The Rust guest helper now requires the Toss Login AccessToken argument so consumers cannot call the
unlink adapter without the upstream credential required by Toss.
