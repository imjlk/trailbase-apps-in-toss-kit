# TrailBase Schema Patterns

SQL schema belongs to the consumer app. This kit may provide template snippets,
but migrations copied into a consumer repo are owned and reviewed there.

Read this before changing SQL, Record API exposure, or TrailBase migration
history in a consumer app.

## Baselines And Additive Migrations

Once production or production-like data exists, do not rewrite baseline SQL for
normal feature work. Add a new forward migration instead.

Safe additive changes include:

- new tables
- new indexes
- new views
- nullable columns
- compatible defaulted columns
- backfills that preserve existing reads and writes

Destructive changes and baseline resets require explicit user intent and a
clear data compatibility decision.

Before editing an existing baseline, ask whether any environment has data that
must survive. If the answer is yes or unknown, create a new additive migration.

## Record API ACL

When a migration changes public tables, views, or subscription surfaces, update
`config.textproto` in the same change. Public Record API should normally expose
read or subscription access only. Writes should go through WASM handlers or jobs
where authorization and invariants live.

Run the consumer's production or ACL checks after changing `config.textproto`.

For new AppsInToss services, use TrailBase `_user` as the Record API principal. Anonymous users
should still receive a `_user` row and TrailBase auth tokens so ACL rules can use `_USER_.id` from
the first app session. The app-owned `users` session pattern is legacy; keep it only while migrating
existing apps.

Keep public user data out of `_user`. Store display names, app avatars, character choices, and other
product fields in `profiles`, `profile_view`, or app domain tables keyed by `_user(id)`. Use
TrailBase `_user_avatar` for auth avatar uploads, not as the only place for app-specific avatar
selection. The kit's minimal `profiles` template is optional but recommended; it keeps
`anonymous_hash_hmac` and `auth_state` beside the app-owned profile row so apps do not overload
`_user.verified` with product meaning.

If a Toss identity collision promotes an existing Toss-linked `_user` to canonical, store the old
anonymous hash in `anonymous_user_links`. Bootstrap handlers can then map the abandoned anonymous
hash to the canonical `_user` before issuing fresh TrailBase auth tokens.

For public bootstrap endpoints, add a coarse app-side guard with `anonymous_bootstrap_attempts` and
`enforce_anonymous_bootstrap_attempt_limit_tx`. This does not replace platform rate limiting, but it
prevents unbounded anonymous `_user` creation when a route is called repeatedly.

## Toss Identity

Apps should store Toss identity without exposing raw identifiers:

- deterministic `toss_user_key_hmac` for lookup
- AES-GCM `toss_user_key_sealed` when reversible access is required

Do not put raw Toss user keys, HMACs, sealed values, or related secrets in
public Record API views, audit metadata, logs, or user-visible responses.

The default `toss_identities` shape references `_user(id)` with a BLOB foreign key. If a consumer
still has `toss_identities.user_id TEXT REFERENCES users(id)`, treat that as a legacy app-owned user
mapping and migrate forward rather than rewriting production baselines.

## Promotion Campaigns

Promotion campaign configuration is generic and can support missions, sharing,
referrals, seasonal events, game rewards, or any other app feature. Keep the
shared `promotion_campaigns` table separate from app-specific eligibility and
grant ledgers, and make claim handlers idempotent before calling the mTLS proxy.

See [promotion-campaigns.md](promotion-campaigns.md) for the full model,
including feature keys, env fallback, ledger ownership, claim idempotency,
request shape, and provider error signals.

## Template Drift

Submodule updates do not update files that were copied out of
`templates/trailbase`. Consumers should periodically compare their local SQL,
Compose, env, and smoke-check files against kit templates and then decide which
changes are appropriate for that app.
