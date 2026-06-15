---
npm/@trailbase-apps-in-toss-kit/toss-mtls-client-proxy: patch
cargo/trailbase-guest-common: patch
---

Add a dedicated Toss Login remove-by-user-key proxy adapter and Rust helper. Consumer WASM guests no
longer need to call the generic mTLS relay with the official Toss path, and the proxy normalizes
unlink responses without echoing raw Toss user keys.
