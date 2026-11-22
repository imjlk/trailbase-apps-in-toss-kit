---
cargo/trailbase-guest-common: patch
cargo/trailbase-toss-identity: patch
---

Upgrade the identity sealing stack to `aes-gcm` 0.11 and `base64` 0.23, aligning AES-GCM with the `hmac` 0.13 / `sha2` 0.11 RustCrypto generation and with the `base64` version TrailBase's own WASM crates already use. The sealed formats do not change: `toss_user_key_sealed` and anonymous-key `v1` values, and keyring `v2` envelopes written by earlier releases still open, and new seals keep the same wire format. Pinned test vectors produced by the previous release guard this. No migration, reseal, env or config change is needed. Consumer WASM guests need Rust 1.89 or newer for the new `aes` crate, which the kit's 1.93 minimum already covers. `aes-gcm` is built without its unused `getrandom` default, because nonces come from the TrailBase WASI random source.
