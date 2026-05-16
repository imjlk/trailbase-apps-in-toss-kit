# TrailBase Ops Reference

## Migration Guardrails

- Treat production and production-like data as durable by default.
- Do not edit baseline SQL for normal feature work after production deploys have started.
- Add a new migration under the repo's TrailBase migration directory for schema changes.
- Keep migrations additive unless the user has explicitly approved a destructive migration/reset.
- Safe additive changes include new tables, indexes, views, nullable columns, backfills, and compatible
  defaulted columns.
- If `config.textproto` or Record API exposure changes, update it in the same change as the migration.

## Baseline Reset And Fresh Start

- Baseline rewrites are allowed only for explicit baseline reset, local-only cleanup, or intentionally
  disposable early deployments.
- `TRAILBASE_FRESH_START_TOKEN` is destructive when paired with the repo's confirmation variable.
- Reusing the same fresh-start token should not delete data again when the repo tracks an applied
  marker, but changing the token requests another reset.
- Keep fresh-start env values empty in normal production runs.

## Record API And Public Surface

- Public Record API should be read/subscription only unless a repo explicitly documents otherwise.
- App and admin writes should go through WASM endpoints/jobs where authorization and invariants live.
- Never expose raw Toss user keys, HMACs, sealed values, secrets, or admin-only projections through
  Record API or user-visible responses.
- Run the repo's ACL check when available after changing `config.textproto`.

## WASM And Runtime Settings

- Run `cargo check --manifest-path apps/trailbase/wasm/Cargo.toml --workspace --target wasm32-wasip2`
  or the repo script equivalent after WASM changes.
- Keep API response shape and Record API wire shape stable unless the user explicitly asks for a
  breaking change.
- Use repo-local settings helpers and production validators instead of ad hoc env parsing.

## Deployment And mTLS Proxy

- TrailBase is a SQLite single-writer service. Prefer build/pull followed by `up -d --no-deps
  --force-recreate trailbase`; avoid rolling updates and avoid `docker compose down` in production.
- The mTLS proxy is an internal outbound client proxy, not a public callback server.
- The proxy image can be public, but the running proxy service should stay private on the internal
  Compose/platform network.
- Mount Toss certificate files only into the proxy container, typically at `/run/mtls`.
- Application services should see only the internal proxy URL and bearer token.
- Production image references should use exact SemVer or minor tags, not `edge` or `latest`, unless
  moving tags are intentionally being tested.

## Repo Discovery Checklist

Before changing a TrailBase app, inspect:

- `AGENTS.md`
- `apps/trailbase/README.md`
- `apps/trailbase/RUNBOOK.md`
- `apps/trailbase/scripts/production-release-check.sh`
- `apps/trailbase/traildepot-template/config.textproto`
- `apps/trailbase/traildepot-template/migrations/main/`
