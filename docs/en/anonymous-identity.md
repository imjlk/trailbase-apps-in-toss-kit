# Verified Anonymous Identity

Apps in Toss anonymous identities still use the existing `ait:<hash>` bootstrap
seed. The new server verification helper sends only the unprefixed key through
the private mTLS proxy to the [official verification API](https://developers-apps-in-toss.toss.im/api/user-key).
Both a SUCCESS envelope and boolean `success: true` are required; HTTP 200 alone
is insufficient. The proxy exposes `POST /internal/apps-in-toss/anonymous-key/verify`
with `{ "anonKey": "..." }` and returns only verification status. It never echoes
the key or upstream error text. Explicit proxy stub mode remains available for
local tests and must not be used for production verification.

## Bootstrap Integration

1. Rate-limit the public bootstrap endpoint before verification or account creation.
   Accept the existing client `anonymousHash` from `getAnonymousKey()`; do not treat
   local `dev-*` keys or the SANDBOX login referrer as verified anonymous identities.
2. Outside a database transaction, call
   `anonymous_identity::verify_anonymous_hash(proxy_url, token, anonymous_hash)`.
   A failed verification must not create or authenticate a `_user`.
3. Use the returned `VerifiedAnonymousKey::hmac` with the consumer's existing
   anonymous HMAC secret. It hashes the same complete `ait:<hash>` string; do not
   change the seed, HMAC key, synthetic email, or existing account mapping.
4. Resolve `anonymous_user_links` before creating/loading the canonical `_user`.
   Reject disabled app principals. Use `ensure_verified_auth_user_tx` and the
   existing official TrailBase login/password-rotation helpers for auth tokens.
5. Seal with `trailbase_toss_identity::seal_verified_anonymous_key`. In the same
   transaction as account linking, call
   `anonymous_identity::store_verified_anonymous_identity_tx` for the canonical
   user. A collision with another owner or a revoked identity is rejected; the
   helper cannot silently move ownership or revive a revoked identity.

`VerifiedAnonymousKey` and stored recipient types intentionally do not implement
Debug or Serialize. Do not return raw anonymous keys, HMACs, or sealed values from
public APIs or put them in logs. Verification establishes the validity of the
opaque key, not eligibility for a promotion or permission to send a message.

## Additive Migrations and Message Dispatch

Apply these as new consumer migrations, in order:

- `anonymous_identities.sql`
- `message_outbox_recipients.migration.sql` (once, after the existing outbox)
- `promotion_reward_recipients.sql` (after the promotion ledger, when used)

Keep all three private. Stop old dispatch workers before enabling anonymous rows.
The recipient migration adds `recipient_kind` and `anonymous_hash_hmac` to the
existing outbox. Login rows keep their HMAC and ciphertext unchanged. Anonymous
rows use an empty compatibility placeholder in the legacy NOT NULL
`toss_user_key_hmac`; the actual anonymous identity is held in separate columns
and a private identity table. SQL triggers reject mixed identities, missing keys,
revoked identities, and cross-user bindings. Do not send anonymous rows through
legacy helpers that interpret the old column as a Toss login identity.

Use `message_recipients::enqueue_anonymous_message_outbox_tx`, then the lease
helpers described in [Functional Messages](functional-messages.md). Immediately
before obtaining the dispatch permit, call `message_recipient_dispatch_gate_tx`
for both recipient kinds and require `allowed`. This uses the same template,
functional notification agreement, and marketing consent checks keyed by `_user`.
Also enforce app-specific disabled-user and eligibility rules.

Load the currently active identity with `message_recipient_for_dispatch_tx`.
Unseal anonymous keys with `unseal_anonymous_key` and login keys with
`unseal_toss_user_key`; use `payload_with_recipient` and the corresponding
`ProxyRecipient` variant. The payload includes exactly one of `anonKey` or
`tossUserKey`. The private proxy sends only `x-anon-key` for anonymous messages.
Revoked/changed identity ownership stops dispatch; linking/moving queued work to
another canonical user is an app-owned transaction that must recheck consent.

## Anonymous Promotion and Recovery

The proxy's promotion prepare, execute, and status endpoints accept `anonKey` as an alternative
to `tossUserKey`. Supplying both is rejected. Since the promotion v2
contract (api-core 0.5.0), prepare is recipient-bound: it issues a key for
exactly one recipient and forwards the official recipient header itself.
The proxy does NOT orchestrate the steps — the caller runs
prepare → persist the key → atomically claim execution (the committed
`execution_started_at` marker) → execute → status, one request per
endpoint, persisting the transaction key between prepare and execute and
committing the claim before the external execute call so a crash afterwards
leaves the row in the recovery set instead of being silently re-executed. Prepare success
means key issuance only; execute `SUBMITTED` is not a grant; the status
lookup reports the observed verdict (`checkedAt`, no fabricated
`grantedAt`). No shared mutable recipient state or certificate access is
added to the app container.

Create the normal `_user`-keyed promotion ledger row (prepare issues the key with `anonKey` as the bound recipient) and call
`bind_anonymous_promotion_recipient_tx` in the same transaction. Persist every
returned provider transaction key. For later recovery, load
`anonymous_promotion_recipient_tx`, construct the anonymous payload with the saved
transaction key, and call `apps_in_toss_proxy::promotion_reward_status_with_payload`.
The identity binding prevents a subsequent Toss login from changing the recovery
recipient. Missing keys or revoked identities require explicit reconciliation;
never allocate another key merely because the first outcome is unknown.

Select a proxy advertising the versioned promotion capabilities
(`promotion.prepare.v2`, `promotion.execute.v2`, `promotion.status.v2`) —
the batch grant route is gone and pre-v2 proxies do not expose this
contract — before using these endpoints. Local
contract/SQL tests are provided; consuming apps still need sandbox/real-app
bootstrap, notification-agreement, and promotion tests before rollout.

Anonymous enqueue trims message/template/request identifiers and treats blank
optional IDs as absent, matching the existing login-recipient enqueue path.
