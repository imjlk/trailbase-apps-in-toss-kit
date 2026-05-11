# Consumer Migration Guide

Follow this when migrating an existing TrailBase-backed AppsInToss project to the shared kit.

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

Copied templates are not live-linked to the submodule. After updating this kit,
compare `templates/trailbase` against the consumer app's copied SQL, Compose,
env, and smoke files and commit any consumer-side changes explicitly.

Use the advisory drift checker from this repo when updating a consumer:

```bash
node scripts/compare-consumer-templates.mjs /path/to/consumer
```

The command exits successfully by default and prints candidate diffs. Use
`--strict` when you want missing candidates or template drift to fail a check.

For app-specific copies, provide an explicit mapping file to avoid noisy candidate discovery:

```bash
node scripts/compare-consumer-templates.mjs /path/to/consumer --mapping apps/trailbase/kit-template-map.json
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
node scripts/check-consumer-submodule.mjs /path/to/consumer --strict
```
