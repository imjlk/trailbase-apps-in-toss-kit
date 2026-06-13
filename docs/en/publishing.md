# Public Publishing Notes

This repository is intended to be safe for a public GitHub repository.

## Safe To Publish

- Rust helper crates and SQL templates.
- Bun proxy source code.
- Dockerfile and GitHub Actions workflows.
- Example environment files that contain placeholders only.
- Public AppsInToss API paths and public base URLs.

## Do Not Commit

- mTLS client certificates or private keys.
- Real `MTLS_PROXY_TOKEN` values.
- Real Toss promotion codes.
- Real app secrets, HMAC secrets, encryption keys, or Coolify `.env.production` files.
- Logs containing raw Toss `userKey` values.

## GHCR Image

The workflow publishes the proxy image to GitHub Container Registry:

```text
ghcr.io/imjlk/trailbase-apps-in-toss-kit/toss-mtls-client-proxy
```

It runs on source changes, release tags, manual dispatch, and a twice-monthly scheduled rebuild. The
scheduled rebuild refreshes the `edge` and `sha-*` tags when the upstream Bun base image receives
patches.

## Tag Policy

The proxy image workflow reads `services/toss-mtls-client-proxy/package.json`. When the Sampo
release PR bumps that private npm package version on `main`, the workflow creates the matching
`toss-mtls-client-proxy-vX.Y.Z` tag if it does not already exist and publishes the release image
tags. Manual `toss-mtls-client-proxy-vX.Y.Z` tag pushes are still supported; the workflow validates
that the tag version matches the proxy package version.

- `edge`: latest successful `main` or scheduled build.
- `sha-<shortsha>`: source commit tag for audit and rollback. Scheduled rebuilds can repush
  this tag when the base image changes.
- `latest`: latest intentional release, useful for manual testing but not preferred for production.
- `0.1.6`, `0.1`, `0`: SemVer release aliases.

For Coolify production, prefer an exact `0.1.6` tag or a minor tag such as `0.1`. Use `latest` or
`edge` only when you deliberately want to track moving image builds.

## Versioning

Sampo is initialized for Rust WASM crate and private JS package version/changelog management. Add a
changeset for user-facing Rust helper changes, proxy changes, or shared JS package changes and let
the `Sampo release` workflow open or refresh the generated release PR after the feature PR lands on
`main`. The Rust helper crates are configured as a fixed version group. JS packages stay private and
are not published to npm; proxy GHCR tags move from the proxy `package.json` version.

The image is safe to make public because certificates and tokens are only provided at runtime. The
running proxy instance should remain private on the application network.
