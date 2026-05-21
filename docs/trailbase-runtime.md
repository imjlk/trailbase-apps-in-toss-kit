# TrailBase Runtime Helpers

This kit provides reusable runtime helpers for TrailBase-backed AppsInToss
services. The helpers are intentionally small and source-consumed through the
git submodule. Consumer apps still own their Dockerfile, Compose files,
`entrypoint.sh`, TrailBase depot, app-specific settings, and deployment policy.

## Runtime Boundary

The shared runtime package is for repeatable container startup mechanics:

- resolving and normalizing the public TrailBase URL
- guarding production placeholders and development secrets
- applying a fresh-start request once per token
- syncing `config.textproto` `site_url`
- copying migrations and components into the TrailBase depot
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
