# Versioning

This repository uses Sampo for changeset-driven version and changelog management.

## Packages

- `cargo/trailbase-guest-common`
- `cargo/trailbase-toss-identity`
- `npm/@trailbase-apps-in-toss-kit/toss-mtls-client-proxy`

The two Rust WASM helper crates are configured as a fixed group in `.sampo/config.toml` so they move
together. The Bun mTLS proxy is a private npm package; Sampo manages its version and changelog, but
it is not published to npm. Its GHCR image release version comes from
`services/toss-mtls-client-proxy/package.json`.

## Regular Change Flow

```bash
sampo add
sampo release
git push origin main
```

`sampo release` consumes pending changesets, bumps package versions, and updates package
changelogs. For proxy changes, target the private npm package:

```md
---
npm/@trailbase-apps-in-toss-kit/toss-mtls-client-proxy: patch
---

Describe the proxy change.
```

## Proxy Image Release Flow

After `sampo release` bumps the proxy package version and the release commit lands on `main`, the
GHCR image workflow reads `services/toss-mtls-client-proxy/package.json`. If
`toss-mtls-client-proxy-vX.Y.Z` does not exist yet, the workflow creates that git tag and pushes the
`latest`, `X.Y.Z`, `X.Y`, and `X` image tags in the same run.

Manual `toss-mtls-client-proxy-vX.Y.Z` tag pushes are still supported. The workflow rejects a release
tag when it does not match the proxy package version.

## Image Tags

- `edge`: latest successful `main` or scheduled build.
- `sha-<shortsha>`: source commit tag for audit and rollback. Scheduled rebuilds can repush
  this tag when the base image changes.
- `latest`: latest intentional proxy image release.
- `0.1.4`, `0.1`, `0`: SemVer release aliases.

Production deployments should prefer an exact SemVer tag such as `0.1.4`, or a minor tag such as
`0.1` when intentional. Use `latest` or `edge` only when a consumer app deliberately wants to track
moving image builds.
