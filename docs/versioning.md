# Versioning

This repository uses Sampo for changeset-driven version and changelog management.

## Packages

- `cargo/trailbase-guest-common`
- `cargo/trailbase-toss-identity`

The two Rust WASM helper crates are configured as a fixed group in `.sampo/config.toml` so they move
together. The Bun mTLS proxy is intentionally kept as a private package, so Sampo does not manage it
as an npm package yet. Its image release version comes from
`services/toss-mtls-client-proxy/package.json`.

## Regular Change Flow

```bash
sampo add
sampo release
git push origin main
```

`sampo release` consumes pending changesets, bumps Rust crate versions, and updates package
changelogs.

## Proxy Image Release Flow

The GHCR image release workflow reads the proxy package version from
`services/toss-mtls-client-proxy/package.json`.

```bash
version="$(node -p "require('./services/toss-mtls-client-proxy/package.json').version")"
git tag "toss-mtls-client-proxy-v${version}"
git push origin "toss-mtls-client-proxy-v${version}"
```

The workflow rejects a release tag when it does not match the proxy package version.

## Image Tags

- `edge`: latest successful `main` or scheduled build.
- `sha-<shortsha>`: immutable build tag for audit and rollback.
- `latest`: latest intentional proxy image release.
- `0.1.0`, `0.1`, `0`: SemVer release aliases.

Production deployments should use `latest`, `0.1`, or an exact SemVer tag. Use `edge` only when a
consumer app deliberately wants to track every main-branch image build.
