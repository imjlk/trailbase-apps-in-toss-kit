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

Use TrailBase `_user` as the Record API principal. Anonymous users should still receive a `_user`
row and TrailBase auth tokens so ACL rules can use `_USER_.id` from the first app session. Do not
add an app-owned `users` auth table for new work. If one already exists, treat it as a removal target:
move product fields to `_user`-keyed `profiles` or domain tables, switch references, then drop the
old table when the data decision allows it.

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
still has `toss_identities.user_id TEXT REFERENCES users(id)`, migrate it to `_user(id)`: add or
derive canonical `_user` rows, rewrite references, and remove the old app-owned auth table after the
consumer's data retention decision is explicit.

## Promotion Campaigns

Promotion campaign configuration is generic and can support missions, sharing,
referrals, seasonal events, game rewards, or any other app feature. Keep the
shared `promotion_campaigns` table separate from app-specific eligibility and
grant ledgers, and make claim handlers idempotent before calling the mTLS proxy.
New apps can start provider grant ledgers from
`templates/trailbase/sql/promotion_reward_ledger.sql`, while existing apps
should migrate their own ledgers forward.

See [promotion-campaigns.md](promotion-campaigns.md) for the full model,
including feature keys, env fallback, ledger ownership, claim idempotency,
request shape, and provider error signals.

## IAP Orders

IAP order status checks and local product grants are functional ledgers. Use
`templates/trailbase/sql/iap_orders.sql` when TrailBase should persist
order/grant state, and keep product entitlement rules in app-owned WASM
handlers. See [iap-orders.md](iap-orders.md).

## Domain Events

AppsInToss Analytics should remain the source for launched-app click,
impression, and funnel reporting. Page navigation logs are collected
automatically, while meaningful clicks and impressions can be sent with
`Analytics.Press`, `Analytics.Impression`, or `Analytics.Area` in live
environments.

TrailBase domain events are a separate app-owned history and operations
ledger. Use them for in-app timelines, support diagnostics, idempotent feature
audits, or server-side state changes that must be visible before AppsInToss
Analytics is available. Do not store raw Toss user keys, HMACs, sealed values,
tokens, or secrets in event metadata.

Detailed analytics events are not the same as feature ledgers. If the app wants
to mirror product analytics into TrailBase, prefer the optional
`analytics.events` template in a separate `analytics` database and keep
notification agreements, message outbox rows, promotion grants, IAP grants, and
reward records in their feature-owned tables. The older
`analytics.analytics_events` template remains available only as a compatibility
path for existing deployments.

The optional `trailbase_guest_common::domain_events` helpers insert and list
events against an app-owned table. Keep the schema in the consumer app, for
example:

```sql
CREATE TABLE app_events (
  id INTEGER PRIMARY KEY,
  user_id TEXT,
  event_name TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
  source_type TEXT,
  source_id_json TEXT CHECK (source_id_json IS NULL OR json_valid(source_id_json)),
  request_id TEXT,
  created_at INTEGER NOT NULL
) STRICT;

CREATE INDEX idx_app_events_user_created
  ON app_events(user_id, created_at DESC);
```

Use stable names such as `mission_claim`, `furnace_save`, or
`promotion_reward_requested`, and keep metadata structured so the same names can
map cleanly to AppsInToss Analytics parameters when needed.

## Template Drift

Submodule updates do not update files that were copied out of
`templates/trailbase`. Consumers should periodically compare their local SQL,
Compose, env, and smoke-check files against kit templates and then decide which
changes are appropriate for that app.
