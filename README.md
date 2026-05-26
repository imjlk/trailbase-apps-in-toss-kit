# TrailBase Apps in Toss Kit

Reusable building blocks for AppsInToss services, with TrailBase-focused
templates plus a standalone Toss mTLS client proxy that can be used by other
server stacks.

TrailBase is the backend runtime this kit targets for AppsInToss mini-apps. In
this architecture, TrailBase owns the SQLite database, Record API, Rust WASM
handlers, jobs, and runtime directory (`traildepot`) for each consumer app. The
kit collects the parts that repeat across those apps: WASM guest helpers, safe schema and
deployment templates, production checks, React Native client glue, and the
private mTLS proxy used to call Toss APIs that require client certificates.

The consuming app still owns its product schema, migrations, Record API ACL,
public API shapes, environment policy, and release decisions. Treat this kit as
a toolbox for TrailBase-backed AppsInToss services, not as a replacement for the
app's TrailBase project.

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
  en/
  ko/
```

Documentation is maintained in English and Korean. English canonical docs live
under `docs/en/`; Korean translations with matching filenames live under
`docs/ko/`. Korean translations for Markdown files outside `docs/` use a
`-ko.md` suffix, such as `README-ko.md`.

Start with `docs/en/index.md` or `docs/ko/index.md` when deciding which part of
the kit to adopt.

## Reference Docs

- [TrailBase](https://trailbase.io/) and TrailBase docs for
  [Record APIs](https://trailbase.io/documentation/apis_record/),
  [migrations](https://trailbase.io/documentation/migrations/), and
  [production setup](https://trailbase.io/documentation/production/).
- [AppsInToss Developer Center](https://developers-apps-in-toss.toss.im/).
- [Coolify Docker Compose docs](https://coolify.io/docs/knowledge-base/docker/compose).
- [Bun docs](https://bun.com/docs).
- [TanStack DB](https://tanstack.com/db/latest/docs) and
  [TanStack Query](https://tanstack.com/query/latest/docs/framework/react/overview).

## Integration Model

Use Rust crates through a path dependency from the submodule. Copy SQL and Compose templates into
the app repository before editing them, because database migrations should be owned by the app that
runs them.

The mTLS proxy is not TrailBase-specific. TrailBase WASM guests can call it through the helper
crates, but any backend that can make an authenticated HTTP request on a private network can use the
same container. Keep certificates mounted only into the proxy, give the application service only the
internal proxy URL and bearer token, and call either the generic mTLS relay or the AppsInToss adapter
endpoints.

The mTLS proxy image is safe to publish as long as certificates and tokens are only provided at
runtime. The running proxy instance should stay private on the Compose or platform-internal network.

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
- `sha-<shortsha>`: source commit tag for audit and rollback. Scheduled rebuilds can repush
  this tag when the base image changes.
- `latest`, `0.1.0`, `0.1`, `0`: release tags created when a Sampo release bumps the proxy
  package version on `main`, or from a matching manual `toss-mtls-client-proxy-v0.1.0` tag.

Renovate tracks package-level updates for GitHub Actions, Docker, Cargo,
Bun/npm, mise tool versions, and documented TrailBase reference versions.
TrailBase release notes are tracked separately by the `TrailBase release watch`
workflow because upstream publishes operational compatibility notes, including
Rust MSRV/MVRV and Rust toolchain changes, in GitHub releases and CHANGELOG
entries.

Do not automatically raise the kit's minimum supported TrailBase server version.
Raise it only after consumer-app smoke tests pass. See
`docs/en/trailbase-tracking.md` and `docs/ko/trailbase-tracking.md` for the
tracking policy.

## Versioning

Sampo is initialized for changeset-driven version and changelog management. The Rust helper crates
are configured as a fixed group so `trailbase-guest-common` and `trailbase-toss-identity` move
together. The Bun proxy is tracked as a private npm package for versioning only; it is not published
to npm.

Typical flow:

```bash
sampo add
sampo release
git push origin main
```

When `sampo release` bumps the proxy package version and the release commit lands on `main`, the
image workflow creates the matching `toss-mtls-client-proxy-vX.Y.Z` git tag if needed and publishes
the GHCR release tags.

See `docs/en/versioning.md` for the detailed release and image tag policy. See
`docs/ko/versioning.md` for the Korean translation.
