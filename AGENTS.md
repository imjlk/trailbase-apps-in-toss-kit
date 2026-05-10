# Agent Guide

This repository is a reusable kit for AppsInToss services backed by TrailBase.
It is intended to be consumed as a git submodule, usually at
`vendor/trailbase-apps-in-toss-kit`.

## Repository Shape

- `crates/trailbase-guest-common`: small Rust helpers for TrailBase WASM guests.
- `crates/trailbase-toss-identity`: Toss identity HMAC/AES-GCM helpers.
- `services/toss-mtls-client-proxy`: Bun-based internal mTLS client proxy.
- `templates/trailbase`: copy-in SQL, Compose, env, smoke, and integration snippets.
- `docs`: integration, publishing, Coolify, identity, proxy, and versioning notes.

Consumer apps should import Rust crates through path dependencies from the
submodule. SQL migrations and Compose files should be copied into the consumer
app and owned there, because runtime schema and deployment shape are app-specific.

## Current Consumers

- Primary active consumer: `/Users/imjlk/repos/_ait/light-on-off`
- Planned follow-up consumer: `/Users/imjlk/repos/_ait/zero-three-three`

When editing this repo from a consumer app, make changes in the real repo at
`/Users/imjlk/repos/_ait/trailbase-apps-in-toss-kit`, commit them there, then
update the consumer app's submodule pointer.

## Safety Rules

- Do not commit mTLS certificates, private keys, proxy tokens, Toss promotion
  codes, app secrets, HMAC secrets, encryption keys, production env files, or
  real logs.
- Do not log or persist raw Toss `userKey` outside the narrow proxy response and
  identity-linking boundary.
- Application tables should store Toss identity as:
  - deterministic `toss_user_key_hmac` for lookup
  - AES-GCM `toss_user_key_sealed` when reversible access is needed
- Never put raw Toss user keys, HMACs, sealed values, or secrets in public
  Record API views, audit metadata, or user-visible responses.
- The proxy image may be public. The running proxy instance should be private on
  the Compose/internal network.
- Keep certificates mounted only into the proxy container. TrailBase should see
  only `MTLS_PROXY_URL` and `MTLS_PROXY_TOKEN`.

## mTLS Proxy Design

`toss-mtls-client-proxy` is an internal client proxy, not a public callback
server. TrailBase calls it over the internal network; the proxy opens outbound
mTLS requests to Toss and returns the upstream response on the same request.
It does not need public ingress.

The proxy has a generic endpoint:

- `POST /internal/mtls/request`

It also has AppsInToss adapter endpoints:

- `GET /internal/apps-in-toss/health`
- `POST /internal/apps-in-toss/toss-login/complete`
- `POST /internal/apps-in-toss/iap/order/status`
- `POST /internal/apps-in-toss/promotion/reward/grant`
- `POST /internal/apps-in-toss/smart-message/send`

Current implemented areas are Toss Login, in-app purchase order status,
promotion reward grant, and smart message send. Toss Pay can be added as another
adapter on top of the generic mTLS relay when the app needs it.

Keep Toss API paths and certificate default paths as code constants where
possible. Avoid turning stable constants into environment variables. Runtime env
should stay focused on mode, auth token, upstream base URL, cert paths when
overridden, and feature-specific secrets that truly vary by deployment.

## Development Commands

From this repository root:

```bash
cargo check --workspace --target wasm32-wasip2
bun test services/toss-mtls-client-proxy
docker build -f services/toss-mtls-client-proxy/Dockerfile -t toss-mtls-client-proxy:local .
```

Proxy local run:

```bash
MTLS_PROXY_MODE=stub MTLS_PROXY_TOKEN=dev-token bun services/toss-mtls-client-proxy/src/server.mjs
```

Forward mode requires upstream URL and mounted cert files:

```text
MTLS_PROXY_MODE=forward
MTLS_PROXY_TOKEN=...
MTLS_UPSTREAM_BASE_URL=https://...
MTLS_CLIENT_CERT_PATH=/run/mtls/client-cert.pem
MTLS_CLIENT_KEY_PATH=/run/mtls/client-key.pem
MTLS_CA_CERT_PATH=/run/mtls/ca-cert.pem
```

## Versioning And Releases

Sampo is used for Rust WASM crate versioning and changelogs. The local CLI
version in use is `0.17.4`.

Typical Rust helper change flow:

```bash
sampo add
sampo release
git push origin main
```

The two Rust crates are configured as a fixed group and should move together.
The Bun proxy is private and not Sampo-managed as an npm package. Its container
release version comes from `services/toss-mtls-client-proxy/package.json`.

Proxy image release flow:

```bash
version="$(node -p "require('./services/toss-mtls-client-proxy/package.json').version")"
git tag "toss-mtls-client-proxy-v${version}"
git push origin "toss-mtls-client-proxy-v${version}"
```

GHCR image:

```text
ghcr.io/imjlk/trailbase-apps-in-toss-kit/toss-mtls-client-proxy
```

Image tag policy:

- `edge`: latest successful main or scheduled build.
- `sha-<shortsha>`: immutable build tag for audit and rollback.
- `latest`, `0.1.0`, `0.1`, `0`: intentional SemVer image release tags.

Prefer exact SemVer or minor tags for production. Use `edge` only when a
consumer app deliberately wants every main-branch image build.

## Dependabot And CI

Dependabot runs monthly for:

- GitHub Actions
- Docker
- Cargo
- Bun/npm for the proxy package

The proxy image workflow publishes to GHCR on source changes, manual dispatch,
scheduled rebuilds, and release tags.

## Consumer Integration Notes

For a TrailBase consumer app:

1. Add this repo as `vendor/trailbase-apps-in-toss-kit`.
2. Reference Rust crates via path dependencies.
3. Copy SQL/Compose/env templates into the app repo before editing.
4. Keep production proxy private and route only the TrailBase service publicly.
5. Validate that no raw Toss identifiers or secrets appear in logs or public API.
6. After changing this kit, commit/push this repo first, then update the
   consumer app's submodule pointer and commit that pointer change.

For `light-on-off`, local TrailBase/proxy scripts live in the consumer app, not
in this kit. Do not make this repo depend on a specific consumer app path.
