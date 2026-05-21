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

## Template Drift

Submodule updates do not update files that were copied out of
`templates/trailbase`. Consumers should periodically compare their local SQL,
Compose, env, and smoke-check files against kit templates and then decide which
changes are appropriate for that app.
