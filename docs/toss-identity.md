# Toss Identity Pattern

Apps start with an anonymous `users` row. Toss Login links that anonymous user to an ACTIVE
`toss_identities` row only when a feature requires it, such as purchase restore or server-side Toss
API calls.

Do not store raw Toss `userKey` values in application tables, Record API views, audit metadata, or
logs. Store:

- `toss_user_key_hmac`: deterministic lookup key using `TOSS_USER_KEY_HMAC_SECRET`.
- `toss_user_key_sealed`: AES-GCM sealed value using `TOSS_USER_KEY_ENC_KEY`.

`TOSS_USER_KEY_ENC_KEY` is a database encryption root. It must decode to exactly 32 bytes. Rotating
it requires a deliberate re-seal migration.
