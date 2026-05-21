# Agent Guide

This repository is a reusable kit for AppsInToss services backed by TrailBase.
It is intended to be consumed as a git submodule, usually at
`vendor/trailbase-apps-in-toss-kit`.

## Repository Shape

- `crates/trailbase-guest-common`: small Rust helpers for TrailBase WASM guests.
- `crates/trailbase-toss-identity`: Toss identity HMAC/AES-GCM helpers.
- `services/toss-mtls-client-proxy`: Bun-based internal mTLS client proxy.
- `skills`: repo-tracked agent skills with adapters for Codex/OpenAI and other assistants.
- `templates/trailbase`: copy-in SQL, Compose, env, smoke, and integration snippets.
- `docs`: integration, publishing, Coolify, identity, proxy, and versioning notes.

Consumer apps should import Rust crates through path dependencies from the
submodule. SQL migrations and Compose files should be copied into the consumer
app and owned there, because runtime schema and deployment shape are app-specific.

## Consumer Notes

If you keep workstation-specific consumer checkout paths for local testing, put
them in `.local-consumers.md`. That file is ignored and must not become a source
of truth for repo behavior.

For TrailBase migrations, Record API ACL, WASM guest, Coolify deployment,
fresh-start, or mTLS proxy work, use `$trailbase-ops` after syncing the repo
skills with `bun run skills:sync` or the relevant adapter command in
`docs/skills.md`. If the skill is not installed in the current session, read
`skills/trailbase-ops/SKILL.md` and
`skills/trailbase-ops/references/trailbase-ops.md` directly.

When editing this repo from a consumer app, make changes in the real repo at
the kit checkout, commit them there, then update the consumer app's submodule
pointer.

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
server. TrailBase and other backend stacks can call it over a private network;
the proxy opens outbound mTLS requests to Toss and returns the upstream response
on the same request. It does not need public ingress.

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

The proxy container is reusable outside TrailBase as long as the caller can send
authenticated HTTP requests on the internal network. Keep app containers away
from certificate files; only the proxy should mount `/run/mtls`.

Keep Toss API paths and certificate default paths as code constants where
possible. Avoid turning stable constants into environment variables. Runtime env
should stay focused on mode, auth token, upstream base URL, cert paths when
overridden, and feature-specific secrets that truly vary by deployment.

## Development Commands

From this repository root:

```bash
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
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
# Normal setup: copy one Toss Console pair into /run/mtls:
#   *_public.crt and *_private.key
# Optional fallback when no complete pair is available:
# MTLS_CLIENT_CERT_PATH=/run/mtls/client-cert.pem
# MTLS_CLIENT_KEY_PATH=/run/mtls/client-key.pem
MTLS_CA_CERT_PATH=/run/mtls/ca-cert.pem
```

Forward mode refuses to start without a non-empty `MTLS_PROXY_TOKEN`.
Optional request/response guards are `MTLS_PROXY_REQUEST_BODY_LIMIT_BYTES`,
`MTLS_PROXY_UPSTREAM_BODY_LIMIT_BYTES`, `MTLS_PROXY_UPSTREAM_TIMEOUT_MS`,
`MTLS_PROXY_IAP_ORDER_STATUS_MAX_ATTEMPTS`, and
`MTLS_PROXY_IAP_ORDER_STATUS_RETRY_DELAY_MS`.

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
The Bun proxy is a private npm package tracked by Sampo for version/changelog
management only. It is not published to npm. Its container release version
comes from `services/toss-mtls-client-proxy/package.json`.

Proxy changeset example:

```md
---
npm/@trailbase-apps-in-toss-kit/toss-mtls-client-proxy: patch
---

Describe the proxy change.
```

When `sampo release` bumps that package version and the release commit lands on
`main`, the image workflow creates `toss-mtls-client-proxy-vX.Y.Z` if needed and
publishes the GHCR release tags.

GHCR image:

```text
ghcr.io/imjlk/trailbase-apps-in-toss-kit/toss-mtls-client-proxy
```

Image tag policy:

- `edge`: latest successful main or scheduled build.
- `sha-<shortsha>`: source commit tag for audit and rollback. Scheduled
  rebuilds can repush this tag when the base image changes.
- `latest`, `0.1.4`, `0.1`, `0`: intentional SemVer image release tags.

Prefer exact SemVer or minor tags for production. Use `latest` or `edge` only
when a consumer app deliberately wants moving image builds.

## Dependabot And CI

Dependabot runs monthly for:

- GitHub Actions
- Docker
- Cargo
- Bun/npm for the proxy package

The Rust helper workflow runs format, Clippy, tests, and the `wasm32-wasip2`
check on crate changes. The proxy image workflow publishes to GHCR on source
changes, manual dispatch, scheduled rebuilds, and release tags.

## Consumer Integration Notes

For a TrailBase consumer app:

1. Add this repo as `vendor/trailbase-apps-in-toss-kit`.
2. Reference Rust crates via path dependencies.
3. Copy SQL/Compose/env templates into the app repo before editing.
4. When this kit changes, reconcile copied SQL/Compose/env/smoke templates in
   each consumer app manually; submodule pointer updates do not update files
   that were copied out of `templates/`.
5. Keep production proxy private and route only the TrailBase service publicly.
6. Validate that no raw Toss identifiers or secrets appear in logs or public API.
7. After changing this kit, commit/push this repo first, then update the
   consumer app's submodule pointer and commit that pointer change.

Consumer-local TrailBase/proxy scripts live in the consuming app, not in this
kit. Do not make this repo depend on any particular consumer checkout path.
