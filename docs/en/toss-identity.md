# Toss Identity Pattern

New apps should start with an anonymous TrailBase `_user` row, not an app-owned `users` session row.
The AppsInToss anonymous hash is HMACed, converted into a service-managed `_user.email`, and used to
upsert a verified `_user`. The app then uses TrailBase's auth flow to return auth, refresh, and CSRF
tokens to the client so Record API ACLs can immediately use the current `_USER_`.

The older pattern where an app-owned `users` table issues `APP_SESSION_SECRET` tokens is legacy. It
can be preserved during migrations, but new app state should hang off `_user(id)` through
`profiles`, `profile_view`, or app-specific domain tables.

When Toss Login is completed, link the existing anonymous `_user` to an ACTIVE `toss_identities` row.
Do not create a second user just because Toss Login happened. If the same Toss identity is already
ACTIVE on another `_user`, treat that Toss-linked `_user` as canonical and return fresh TrailBase
tokens for it.

Do not store raw Toss `userKey` values in application tables, Record API views, audit metadata, or
logs. Store:

- `toss_user_key_hmac`: deterministic lookup key using `TOSS_USER_KEY_HMAC_SECRET`.
- `toss_user_key_sealed`: AES-GCM sealed value using `TOSS_USER_KEY_ENC_KEY`.

`TOSS_USER_KEY_ENC_KEY` is a database encryption root. It must decode to exactly 32 bytes. Rotating
it requires a deliberate re-seal migration.

## Anonymous `_user` Bootstrap

Use `trailbase-guest-common` helpers to derive service-managed TrailBase credentials from the
HMACed AppsInToss anonymous hash:

- `anonymous_hash_hmac`: deterministic lookup key derived with `USER_HASH_HMAC_SECRET`.
- synthetic `_user.email`: stable internal email such as `anon+...@users.local.invalid`.
- service-managed password: server-only credential derived from a separate secret.

The synthetic email is a TrailBase auth identifier, not a contact address. Do not send mail to it,
display it to users, or treat `_user.verified = true` as proof that a human email address was
verified. The flag only means the service-managed credential may use TrailBase's normal login flow.

The credential exists to drive TrailBase's official auth flow. Do not send the service-managed
password to the client, and do not reimplement TrailBase JWT signing or `_session` writes in app
code.

After the `_user` upsert commits, call TrailBase's official auth login endpoint with the
service-managed credential. `trailbase-guest-common` exposes `login_auth_user` and
`trailbase_auth_tokens_from_response` helpers for this handoff; they parse the auth, refresh, and
CSRF token response without minting tokens themselves. For credential rotation, use
`login_anonymous_auth_user_with_password_rotation` with `TRAILBASE_AUTH_PASSWORD_SECRET_PREVIOUS`.
Deploy the new current secret plus the previous secret, let active users re-login and rehash, then
remove the previous secret in a later deploy.

Bootstrap endpoints should also protect anonymous creation from abuse. Use
`anonymous_bootstrap_attempts` plus `enforce_anonymous_bootstrap_attempt_limit_tx` for an app-local
coarse guard, and add platform/proxy-level rate limits for public production routes.

On the client, hydrate the official `trailbase` JavaScript SDK with the returned tokens instead of
calling `client.login()` with the service-managed password. `trailbase-client` exposes
`toTrailBaseSdkTokens` and `createTrailBaseClientAuthOptions` for that conversion.

Toss Login's `email` field is not the `_user.email` source of truth for this kit. It may be null,
encrypted, unverified, or scoped differently. Keep the synthetic email unless a future app has a
separate, verified email migration policy.

## Public Profiles

Keep public profile data outside `_user`. Use a `profiles` table keyed by `_user(id)` and expose a
safe `profile_view` through Record API when needed. TrailBase's `_user_avatar` is for auth avatar
uploads; app-specific character choices, cat avatars, or visual identities belong in `profiles` or
domain tables. The minimal profile pattern tracks `auth_state` separately from `_user.verified`:
`anonymous`, `toss_linked`, `email_linked`, or `disabled`.

When Toss Login finds a Toss identity that is already linked to a different `_user`, keep that
Toss-linked row as canonical and write `anonymous_user_links`. Future bootstrap calls for the old
anonymous hash should resolve through that alias and return fresh tokens for the canonical user
instead of reviving the abandoned anonymous row.

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
