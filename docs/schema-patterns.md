# TrailBase Schema Patterns

SQL schema belongs to the consumer app. This kit may provide template snippets,
but migrations copied into a consumer repo are owned and reviewed there.

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

## Record API ACL

When a migration changes public tables, views, or subscription surfaces, update
`config.textproto` in the same change. Public Record API should normally expose
read or subscription access only. Writes should go through WASM handlers or jobs
where authorization and invariants live.

Run the consumer's production or ACL checks after changing `config.textproto`.

## Toss Identity

Apps should store Toss identity without exposing raw identifiers:

- deterministic `toss_user_key_hmac` for lookup
- AES-GCM `toss_user_key_sealed` when reversible access is required

Do not put raw Toss user keys, HMACs, sealed values, or related secrets in
public Record API views, audit metadata, logs, or user-visible responses.

## Promotion Campaigns

Use `templates/trailbase/sql/promotion_campaigns.sql` when a consumer app wants
TrailBase to own Toss promotion campaign state instead of relying only on proxy
env vars. The table stores provider promotion code, reward amount, active
window, local budget limit, grant count limit, and operator status.

The campaign table is intentionally separate from app-specific reward ledgers.
Each app should keep its own eligibility and grant table for flows such as
attendance, sharing, or game rewards. Link that ledger to `promotion_campaigns`
with a nullable `campaign_id`, store the proxy's `providerErrorCode` as
`provider_error_code`, and pass the campaign's `provider_promotion_code` plus
`reward_amount` to the mTLS proxy per request.

If any DB campaign row exists for a feature key, prefer DB campaign state for
that feature and ignore env fallback for that feature. If no campaign row
exists, legacy env fallback remains useful for old deployments and local smoke
tests.

Provider error codes should update local operator state conservatively:

- `4112`, `4116`: mark the campaign `EXHAUSTED`.
- `4104`, `4105`, `4108`, `4109`: pause the campaign.
- `4114`: treat as misconfiguration and pause or escalate before retrying.

## Template Drift

Submodule updates do not update files that were copied out of
`templates/trailbase`. Consumers should periodically compare their local SQL,
Compose, env, and smoke-check files against kit templates and then decide which
changes are appropriate for that app.
