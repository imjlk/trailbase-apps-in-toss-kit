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

## Toss Login Unlink Callback

AppsInToss can call a public callback URL when a user disconnects Toss Login from the Toss app. The
callback is an inbound request to the app backend, not a request through the outbound mTLS proxy.

Use `trailbase-toss-identity` helpers to:

- Deserialize `userKey` or `user_key` callback bodies without logging the raw key.
- Validate the Basic Auth header against the console value.
- Normalize unlink referrers such as `UNLINK`, `WITHDRAWAL_TERMS`, and `WITHDRAWAL_TOSS`.
- Validate the `userKey` shape before deriving `toss_user_key_hmac`.

Keep app-specific database updates in the consumer app. Typical handling is to look up
`toss_identities.toss_user_key_hmac`, mark the matching row `REVOKED`, and record an audit/event row
that omits the raw Toss `userKey`.
