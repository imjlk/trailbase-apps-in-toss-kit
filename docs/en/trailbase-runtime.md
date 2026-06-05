# TrailBase Runtime Helpers

This kit provides reusable runtime helpers for TrailBase-backed AppsInToss
services. The helpers are intentionally small and source-consumed through the
git submodule. Consumer apps still own their Dockerfile, Compose files,
`entrypoint.sh`, TrailBase runtime directory (`traildepot`), app-specific settings,
and deployment policy.

Use these helpers when multiple apps are repeating the same container startup
logic. Do not use them to hide app-specific deployment decisions.

## Runtime Boundary

The shared runtime package is for repeatable container startup mechanics:

- resolving and normalizing the public TrailBase URL
- guarding production placeholders and development secrets
- applying a fresh-start request once per token
- syncing `config.textproto` `site_url`
- copying migrations and components into the TrailBase runtime directory (`traildepot`)
- writing JSON settings files
- finding available local host ports for dev stacks
- running `trail run` with a predictable argument shape

The consumer app keeps app-specific behavior:

- app env key names and default values
- database schema ownership and migrations
- app-specific `settings.json` keys
- extra production env rules
- Compose service names, profiles, and resource sizing
- local development defaults for RN and WebView apps

## Adoption Path

1. Keep the consumer entrypoint in the consumer repo.
2. Copy the runtime helper directory into the final image.
3. Source `entrypoint/lib.sh` from the consumer entrypoint.
4. Replace one repeated startup concern at a time, such as public URL
   normalization or `config.textproto` sync.
5. Run the consumer's production env check and WASM check before deploying.

## TrailBase Depot Layout

Consumer apps should keep one Git-tracked depot template and one ignored runtime depot:

- `apps/trailbase/traildepot-template`: the Git-tracked source of truth. Keep
  reviewed files such as `config.textproto`, `migrations/main`, and seed SQL here.
- `apps/trailbase/traildepot`: local or container runtime output. Ignore DBs,
  secrets, uploads, generated WASM, and metadata. Do not track symlinks here by default.

The default repository layout is:

```text
apps/trailbase/
  traildepot-template/
    config.textproto
    migrations/main/
```

The repo root `.gitignore` should ignore the runtime depot:

```gitignore
apps/trailbase/traildepot/
```

For TrailBase CLI access, prefer a root `package.json` alias that executes the
image-bundled CLI inside the running TrailBase container instead of a host-installed binary:

```json
{
  "scripts": {
    "trail": "bash apps/trailbase/scripts/trail-cli.sh"
  }
}
```

The helper should wrap `docker compose exec trailbase /app/trail --data-dir
/app/traildepot ...`. Keep Git-tracked schema/config source in
`traildepot-template`; do not add host-side `traildepot` symlinks by default.

## Entrypoint Pattern

Consumer images should copy the runtime entrypoint library into the final image:

```dockerfile
COPY vendor/trailbase-apps-in-toss-kit/packages/trailbase-runtime/entrypoint /app/trailbase-kit/entrypoint
```

The app entrypoint can then source the helper and keep only app-specific
configuration:

```sh
. /app/trailbase-kit/entrypoint/lib.sh

APP_PUBLIC_URL="$(
  trailbase_runtime_resolve_public_url \
    "APP_BASE_URL" \
    "http://127.0.0.1:4000"
)"

trailbase_runtime_sync_config_site_url \
  "/app/traildepot/config.textproto" \
  "$APP_PUBLIC_URL"
```

## Fresh Start

`TRAILBASE_FRESH_START_TOKEN` is destructive only when paired with the
consumer's explicit confirmation variable. The helper writes a marker for the
last applied token so reusing the same value does not reset data again.

Use fresh-start only for local development, disposable environments, or an
explicit reset operation. Do not use it as a normal production deploy mechanism.

## Local Port Selection

Local stacks often collide on the default TrailBase and mTLS proxy ports. The
runtime helpers can pick the next available port by incrementing from the
preferred value and writing a warning to stderr when the selected port changes.

The intended defaults are:

- TrailBase: `4000`
- mTLS proxy: `8787`

Consumers should surface the selected ports in their local dev command output
so the RN app, WebView app, and smoke checks can target the right URLs.

## Deployment Notes

TrailBase is SQLite-backed and should be treated as a single-writer service.
Prefer recreate-style updates for the TrailBase container. Do not use rolling
updates for production TrailBase services unless the app has a separate,
explicitly tested HA strategy.

The mTLS proxy remains a separate internal service. Certificates mount only into
the proxy container, never into TrailBase or client app containers.
