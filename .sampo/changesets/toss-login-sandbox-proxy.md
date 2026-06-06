---
cargo/trailbase-guest-common: patch
---

Add a shared Toss Login sandbox stub decision helper and document that real
AppsInToss sandbox `authorizationCode` values should be exchanged through the
configured proxy or forward path instead of being treated as local stubs.
