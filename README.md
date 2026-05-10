# TrailBase Apps in Toss Kit

Reusable building blocks for AppsInToss services backed by TrailBase.

This repository intentionally keeps three kinds of assets together:

- Rust crates for TrailBase WASM guests.
- A Bun-based mTLS client proxy for server-to-server Toss API calls.
- Copy-in templates for SQL, Compose, env, smoke scripts, and runbooks.

Consumer apps should add this repository as a git submodule under `vendor/trailbase-apps-in-toss-kit`.

## Layout

```text
crates/
  trailbase-guest-common/
  trailbase-toss-identity/
services/
  toss-mtls-client-proxy/
templates/
  trailbase/
docs/
```

## Integration Model

Use Rust crates through a path dependency from the submodule. Copy SQL and Compose templates into
the app repository before editing them, because database migrations should be owned by the app that
runs them.

The mTLS proxy image is safe to publish as long as certificates and tokens are only provided at
runtime. The proxy instance should stay private on the Compose internal network.

## Container Image

The `toss-mtls-client-proxy` image is published by GitHub Actions to:

```text
ghcr.io/imjlk/trailbase-apps-in-toss-kit/toss-mtls-client-proxy
```

The image contains only Bun runtime code. It does not contain mTLS certificates, proxy tokens,
promotion codes, or app secrets. Mount certificates at runtime and keep the proxy instance
internal-only.

The image workflow runs on proxy source changes, release tags, manual dispatch, and a twice-monthly
scheduled rebuild so patched base images are picked up even when source code is unchanged.

Image tag policy:

- `edge`: latest successful `main` build.
- `sha-<shortsha>`: source commit tag for audit and rollback. Scheduled rebuilds can repush
  this tag when the base image changes.
- `latest`, `0.1.0`, `0.1`, `0`: release tags created when a Sampo release bumps the proxy
  package version on `main`, or from a matching manual `toss-mtls-client-proxy-v0.1.0` tag.

Dependabot runs monthly for GitHub Actions, Docker, Cargo, and Bun/npm dependencies.

## Versioning

Sampo is initialized for changeset-driven version and changelog management. The Rust helper crates
are configured as a fixed group so `trailbase-guest-common` and `trailbase-toss-identity` move
together. The Bun proxy is tracked as a private npm package for versioning only; it is not published
to npm.

Typical flow:

```bash
sampo add
sampo release
git push origin main
```

When `sampo release` bumps the proxy package version and the release commit lands on `main`, the
image workflow creates the matching `toss-mtls-client-proxy-vX.Y.Z` git tag if needed and publishes
the GHCR release tags.

See `docs/versioning.md` for the detailed release and image tag policy.
