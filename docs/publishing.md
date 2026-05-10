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

Use release tags only when you intentionally want to advance the production channel:

```bash
git tag toss-mtls-client-proxy-v0.1.0
git push origin toss-mtls-client-proxy-v0.1.0
```

The workflow validates that the tag version matches
`services/toss-mtls-client-proxy/package.json`.

- `edge`: latest successful `main` or scheduled build.
- `sha-<shortsha>`: immutable build tag for audit and rollback.
- `latest`: latest intentional release.
- `0.1.0`, `0.1`, `0`: SemVer release aliases.

For Coolify production, prefer `latest`, `0.1`, or an exact `0.1.0` tag over `edge`. Use `edge` only
when you deliberately want to track every main-branch image build.

## Versioning

Sampo is initialized for Rust WASM crate version and changelog management. Add a changeset for
user-facing Rust helper changes, run `sampo release`, then push the resulting release commit. The
Rust helper crates are configured as a fixed version group. The proxy package stays private and its
GHCR tags move from the proxy `package.json` version plus an intentional release tag, so image
releases do not force a Rust crate bump.

The image is safe to make public because certificates and tokens are only provided at runtime. The
running proxy instance should remain private on the application network.
