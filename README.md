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
