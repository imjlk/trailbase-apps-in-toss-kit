# TrailBase Apps in Toss Kit

Reusable building blocks for AppsInToss services backed by TrailBase.

This repository intentionally keeps three kinds of assets together:

- Rust crates for TrailBase WASM guests.
- A Bun-based mTLS client proxy for server-to-server Toss API calls.
- Copy-in templates for SQL, Compose, env, smoke scripts, and runbooks.

The first consumer is `light-on-off` through a git submodule. The next migration target is
`zero-three-three`.

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
