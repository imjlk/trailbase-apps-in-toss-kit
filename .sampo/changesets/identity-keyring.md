---
cargo/trailbase-toss-identity: minor
---

Add an opt-in identity encryption key ring with an authenticated v2 key ID,
explicit legacy-v1 reader and bounded restartable reseal batches for the private
Toss/anonymous identity templates. Existing single-key v1 APIs remain unchanged.
Deploy compatible readers before new writers; keep older keys for retained data
and backups. Rebuild WASM and save batch cursors with ciphertext updates in the
same private transaction. Stop old writers and repeat a full sweep before retiring
keys. No identity-column migration is required; consumers own optional job state.

HMAC lookup keys, account ownership and revocation state are unchanged. Do not
log private cursors, ciphertext or keys. A rollback must retain v2-capable readers.
