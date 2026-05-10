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

The image is safe to make public because certificates and tokens are only provided at runtime. The
running proxy instance should remain private on the application network.
