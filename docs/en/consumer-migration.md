# Consumer Migration Guide

Use this guide when an existing TrailBase-backed AppsInToss project already has
its own proxy, SQL snippets, or helper code and you want to move the repeated
parts to the shared kit.

The goal is to reduce duplicated infrastructure without changing the app's
public API, schema ownership, or deployment policy.

## Before You Start

- Make sure the consumer app has a clean working tree or that unrelated local
  changes are easy to separate.
- Identify which files were copied from `templates/trailbase` and which files
  are app-specific.
- Decide whether production or production-like data already exists. If it does,
  do not rewrite baseline migrations as part of the migration.
- Decide whether the app is still on the legacy app-owned `users` session model.
  New work should use TrailBase `_user` for anonymous users and Toss-linked users.

## Migration Checklist

1. Add `vendor/trailbase-apps-in-toss-kit` as a submodule.
2. Replace `apps/toss-mtls-proxy` with the shared `toss-mtls-client-proxy` service.
3. Keep existing Toss adapter paths so current WASM callers keep working.
4. Remove endpoint path override envs:
   - `TOSS_PROMOTION_GET_KEY_PATH`
   - `TOSS_PROMOTION_EXECUTE_PATH`
   - `TOSS_PROMOTION_RESULT_PATH`
   - `TOSS_LOGIN_GENERATE_TOKEN_PATH`
   - `TOSS_LOGIN_ME_PATH`
5. Rename service references from `toss-mtls-proxy` to `toss-mtls-client-proxy`.
6. Run proxy stub smoke, TrailBase Toss smoke, and production release checks.

## Moving From Legacy `users` To `_user`

Legacy AppsInToss consumers often have an app-owned `users` table plus
`APP_SESSION_SECRET` tokens. Keep that shape only for compatibility. The new default is:

1. HMAC the AppsInToss anonymous hash.
2. Create a synthetic `_user.email` and service-managed credential on the server.
3. Upsert a verified `_user`.
4. Create or update app profile/domain rows keyed by `_user(id)`.
5. Use TrailBase's official auth flow to return auth, refresh, and CSRF tokens.
6. Link Toss Login by adding `toss_identities` to the existing anonymous `_user`.

When adding the new auth path, also add the hardening tables that match your migration strategy:
`profiles.minimal.sql` for new/reset apps, and `anonymous_user_links.sql` plus
`anonymous_bootstrap_attempts.sql` for both reset and additive migrations. Keep `auth_state` in the
app profile/domain row, not in `_user`.

If you rotate `TRAILBASE_AUTH_PASSWORD_SECRET`, deploy
`TRAILBASE_AUTH_PASSWORD_SECRET_PREVIOUS` alongside the new current value first. The helper can log
in with the previous derived password once and then rehash `_user.password_hash` with the current
secret.

If production data exists, add forward migrations. Do not rewrite baseline SQL. A `light-on-off`
style migration should keep the existing domain `users` table while adding a `_user` mapping column
or companion profile table, then move Record API ACLs to `_USER_.id` incrementally.

If the app is disposable or intentionally resettable, a baseline reset may be simpler. A
`tatatata-cattower` style early deployment can rebuild the baseline around `_user`, `profiles`, and
the new `toss_identities("user")` foreign key after explicitly accepting data loss.

Do not copy TrailBase JWT signing or `_session` writes into app code. Use TrailBase auth endpoints or
a verified runtime-safe path to mint tokens after the app-specific `_user` mapping is complete.

## Template Drift

Copied templates are not live-linked to the submodule. After updating this kit,
compare `templates/trailbase` against the consumer app's copied SQL, Compose,
env, and smoke files and commit any consumer-side changes explicitly.

Use the advisory drift checker from this repo when updating a consumer:

```bash
bun scripts/compare-consumer-templates.mjs /path/to/consumer
```

The command exits successfully by default and prints candidate diffs. Use
`--strict` when you want missing candidates or template drift to fail a check.

For app-specific copies, provide an explicit mapping file to avoid noisy candidate discovery:

```bash
bun scripts/compare-consumer-templates.mjs /path/to/consumer --mapping apps/trailbase/kit-template-map.json
```

Mapping files use this shape:

```json
{
  "checks": [
    {
      "name": "Proxy env example",
      "template": "templates/trailbase/env/toss-mtls-client-proxy.env.example",
      "consumer": "apps/trailbase/.env.production.example"
    }
  ]
}
```

Use the submodule checker to catch a checkout that was updated without staging the consumer gitlink:

```bash
bun scripts/check-consumer-submodule.mjs /path/to/consumer --strict
```

## Done Looks Like

- The consumer gitlink points at the intended kit commit.
- Copied SQL, Compose, env, and smoke files were reviewed rather than blindly
  overwritten.
- Production env validation still passes.
- Existing TrailBase WASM callers still receive the same response shapes.
