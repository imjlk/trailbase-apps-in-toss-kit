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
- `sha-<shortsha>`: immutable build tag for every pushed image.
- `latest`, `0.1.0`, `0.1`, `0`: release tags only, created from `v0.1.0` or
  `toss-mtls-client-proxy-v0.1.0` when that tag matches the proxy `package.json` version.

Dependabot runs monthly for GitHub Actions, Docker, Cargo, and Bun/npm dependencies.

## Versioning

Sampo is initialized for changeset-driven Rust WASM crate version and changelog management. The Rust
helper crates are configured as a fixed group so `trailbase-guest-common` and
`trailbase-toss-identity` move together. The Bun proxy remains a private package; its GHCR image
release uses `services/toss-mtls-client-proxy/package.json` plus an intentional release tag.

Typical flow:

```bash
sampo add
sampo release
git push origin main
```

Proxy image release flow:

```bash
version="$(node -p "require('./services/toss-mtls-client-proxy/package.json').version")"
git tag "toss-mtls-client-proxy-v${version}"
git push origin "toss-mtls-client-proxy-v${version}"
```

See `docs/versioning.md` for the detailed release and image tag policy.
