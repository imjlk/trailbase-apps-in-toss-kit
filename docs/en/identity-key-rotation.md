# Identity encryption key rotation

`trailbase_toss_identity::TossIdentityKeyRing` adds opt-in encryption-key rotation.
Existing single-key functions still read/write `v1.nonce.ciphertext` unchanged.
The key ring reads v1 only through an explicitly named legacy key and writes
`v2.keyId.nonce.ciphertext`. AES-GCM authenticates the version/key ID as associated
data; nonce and ciphertext tampering also fail authentication. Unknown IDs never
fall back to trial-decrypting other keys. The ring holds at most eight keys, with
one active writer, and limits plaintext to 8 KiB and envelopes to 16 KiB.

Keys remain 32-byte secrets in the existing hex/base64 encoding. IDs are nonsecret
ASCII letters/digits, `_` or `-`, at most 64 characters, and must remain permanently
bound to their original key. Obtain fresh keys through the consumer's secret
management system; do not commit keys, plaintext, ciphertext or private cursors.
The ring and batch progress deliberately have no Debug/Serialize implementation.
This API does not automatically scrub all application-owned string copies from memory.

## Reader-first rollout

1. Deploy the key-ring reader everywhere first, retaining the existing key as the
   explicit v1 legacy key. Include login, anonymous recipient, notification and
   offline job readers. Verify old ciphertext before enabling new writers.
2. Add a new key under a new ID and make it the active writer. `ring.seal(value)`
   uses a fresh WASI random nonce. Keep the HMAC secret, lookup values, user mapping
   and anonymous `ait:` namespace unchanged. Existing identity readers accept a
   closure such as `|sealed| ring.unseal(sealed)`.
3. Stop old-format/old-key writers before the final migration sweep. New v2 values
   are unreadable by the old single-key functions: a code rollback must retain
   key-ring readers. Reverting only the active writer does not remove existing v2 rows.
4. Re-encrypt with bounded private batches and verify coverage, including old
   backups and retained revoked records. Retire a key only after its ciphertext
   and required backups no longer depend on it. Never delete a key to clear errors.

```rust,ignore
// Values come from the consumer secret manager. No literal secrets in source.
let ring = trailbase_toss_identity::TossIdentityKeyRing::new(
    "current", &[("legacy", legacy_key.as_str()), ("current", current_key.as_str())],
    Some("legacy"),
)?;
let hmac = trailbase_toss_identity::toss_user_key_hmac(&unchanged_hmac_secret, &user_key)?;
let sealed = ring.seal(&user_key)?;
// Store using the existing private identity-linking transaction.
```

The key ring preserves the plaintext, including `ait:` for verified anonymous
identities. Validate the identity namespace at the existing linking/recipient
boundary; key rotation is not identity verification or account reassignment.

## Restartable reseal batches

`reseal::reseal_identity_batch_tx` works with the copied `toss_identities` or
`anonymous_identities` templates. It reads at most 100 rows by stable ID, authenticates
every non-null ciphertext (including active-key rows), prepares the batch, then
updates changed ciphertext with a compare-and-swap against the original value.
It changes no HMAC, owner, revocation state or business timestamp. Revoked rows
whose ciphertext is null or the kit’s REVOKED erasure tombstone are skipped for the Toss table.
An active row with a tombstone is still checked and fails authentication.

```rust,ignore
use trailbase_toss_identity::reseal::{reseal_identity_batch_tx, IdentityCiphertextTable};
let mut tx = trailbase_guest_common::db::tx()?;
let progress = reseal_identity_batch_tx(
    &mut tx, IdentityCiphertextTable::Toss, &ring, saved_cursor.as_deref(), 50,
)?;
// Persist progress.next_cursor and progress.complete in an app-owned PRIVATE job
// record bound to this table, rotation ID and active key. Do this in the same tx.
// On any read/authentication/CAS/cursor-save error, roll back the entire tx.
trailbase_guest_common::db::tx_commit(&mut tx)?;
// Report only examined/rewritten counts; the anonymous cursor is itself a HMAC.
```

The caller owns the job cursor and transaction. A crash before commit must preserve
both old ciphertext and old cursor; after commit, retrying from an older cursor
only authenticates already-current rows. Never share a cursor between tables or
rotations. `complete` means this paginated scan reached the end, not that old writers
or concurrent inserts could not have produced earlier-sorting rows. Stop old writers,
restart a full scan from `None` after cutover and verify the remaining key distribution
before retirement. Do not log row IDs, ciphertext, plaintext or raw database failures.

No schema change is needed for ciphertext columns. An app adding persistent job
state owns its new private migration. Rebuild WASM and retain compatible readers
throughout rollout. HMAC lookup-key rotation requires a separate account-mapping
migration plan; this API intentionally does not accept or rotate HMAC secrets.

Validation covers v1/v2 reads, active-key no-op authentication, reseal with unchanged
HMAC, wrong/missing/retired keys, malformed/oversized data, authenticated key-ID
changes even when key bytes match, tampered nonce/ciphertext and SQLite CAS rollback
without overwriting a newer value or altering lookup/revocation fields.
