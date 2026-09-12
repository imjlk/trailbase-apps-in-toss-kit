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
- Check whether the app still has an app-owned `users` session model. Plan to remove that auth table
  and move anonymous plus Toss-linked identity to TrailBase `_user`.

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

## Removing App-Owned `users`

Some older AppsInToss consumers have an app-owned `users` table plus `APP_SESSION_SECRET` tokens.
Do not preserve that as a long-term compatibility layer. Move the app to this flow:

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

If production data exists, add forward migrations. Do not rewrite baseline SQL unless the app has
explicitly chosen a reset. For small datasets, a direct forward migration can create canonical
`_user` rows for existing users, copy product fields into `profiles` or domain tables, repoint domain
foreign keys to `_user(id)`, and then drop the old app-owned auth table in the same migration series.

If the app is disposable or intentionally resettable, a baseline reset may be simpler. Early
deployments can rebuild the baseline around `_user`, `profiles`, and the new `toss_identities("user")`
foreign key after explicitly accepting data loss.

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
cp vendor/trailbase-apps-in-toss-kit/templates/trailbase/release/kit-template-map.example.json \
  apps/trailbase/kit-template-map.json
bun scripts/compare-consumer-templates.mjs /path/to/consumer --mapping apps/trailbase/kit-template-map.json
```

The example mapping covers the core Toss identity SQL, proxy Compose service,
proxy env example, and proxy smoke script. Edit paths and remove checks that do
not apply before making it strict.

Use `--summary` when CI logs or release checklists should show only per-candidate
status plus matched, drift, and missing counts. Re-run without `--summary` when
you need to inspect the full diff.

```bash
bun scripts/compare-consumer-templates.mjs /path/to/consumer --mapping apps/trailbase/kit-template-map.json --summary
```

Mapping files use this shape:

```json
{
  "checks": [
    {
      "name": "Proxy env example",
      "template": "templates/trailbase/env/toss-mtls-client-proxy.env.example",
      "consumer": "apps/trailbase/.env.production.example",
      "mode": "env-subset"
    },
    {
      "name": "Compose toss mTLS proxy",
      "template": "templates/trailbase/compose/toss-mtls-client-proxy.yml",
      "consumer": "apps/trailbase/docker-compose.yml",
      "mode": "compose-service",
      "service": "toss-mtls-client-proxy",
      "volumes": ["mtls_client_certs"]
    }
  ]
}
```

Mapping `mode` defaults to `exact`, which compares the whole file. Use
`compose-service` when a consumer Compose file contains app-owned services around
the copied proxy snippet. Use `env-subset` when a consumer env example keeps the
kit-required proxy keys inside a larger app-specific file.

Use the submodule checker to catch a checkout that was updated without staging the consumer gitlink:

```bash
bun scripts/check-consumer-submodule.mjs /path/to/consumer --strict
```

## Three-Way Upgrade Plan

For an upgrade, keep the previous kit commit before changing the consumer's gitlink.
Set `KIT_PREVIOUS_COMMIT` to that commit and run the planner from the new kit checkout:

```bash
bun scripts/plan-consumer-upgrade.mjs /path/to/consumer \
  --from "$KIT_PREVIOUS_COMMIT" --to HEAD \
  --mapping apps/trailbase/kit-template-map.json
```

The explicit mapping uses the same `exact`, `compose-service`, and `env-subset`
modes described above. The old and new templates come from committed Git objects;
the third input is the consumer's current file, including intentional local edits.
`--from` must be an ancestor of `--to`; fetch the required history first when using
a shallow checkout. The tool never stages files, updates gitlinks, writes consumer
files, executes migrations, or runs the suggested validation commands.

| Status | Meaning |
| --- | --- |
| `unchanged` | No relevant change |
| `consumer-only` | App customization without a kit update to apply |
| `already-applied` | The relevant kit update is already present |
| `update-required` | Kit changes need review in the consumer |
| `mergeable-update` | Both changed; Git's textual three-way merge has no conflict |
| `conflict` | Both changed incompatibly, or an addition/deletion needs reconciliation |
| `kit-removed` | Kit removed the template; do not automatically delete the app file |
| `missing-consumer` | A mapped file is absent even though its template is unchanged |

The report separates kit and consumer hunk line ranges. Compose ranges refer to
the selected service/volume scope, not the original file's line numbers. This is
a textual comparison, not semantic YAML or SQL validation; anchors, inheritance,
and application behavior still require review. Environment reports show key names
and change classifications, never values. Env mode compares active assignments
(last assignment wins); comments and app-only keys are outside that comparison.
No file contents or content hashes appear in either text or JSON output. Temporary
comparison files contain only opaque line IDs, not consumer text or secrets.

Changed SQL is always flagged for consumer-owned forward-migration review unless
already applied. Even `mergeable-update` does **not** authorize rewriting a historical
migration. Newly added or removed templates not covered by the mapping are listed
for applicability review; optional templates are not automatically required.

Use `--json` for a versioned structured report and `--strict` to return exit code 1
when any reconciliation, migration, or unmapped-template review remains. Advisory
mode returns 0 after a successful comparison; invalid refs, unsupported inputs, or
invalid mappings return 2. Mapped paths must stay within their roots, and inputs
must be UTF-8 text files no larger than 1 MiB. Review the report alongside the
[Release Doctor](release-doctor.md), the changesets/changelogs between the two commits,
and the consumer's migration, auth/ACL, and feature smoke checks.

## Done Looks Like

- The consumer gitlink points at the intended kit commit.
- Copied SQL, Compose, env, and smoke files were reviewed rather than blindly
  overwritten.
- Production env validation still passes.
- Existing TrailBase WASM callers still receive the same response shapes.
