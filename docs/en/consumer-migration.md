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
