# Versioning

This repository uses Sampo for changeset-driven version and changelog management.

## Packages

- `cargo/trailbase-guest-common`
- `cargo/trailbase-toss-identity`
- `npm/@trailbase-apps-in-toss-kit/toss-mtls-client-proxy`
- `npm/@trailbase-apps-in-toss-kit/trailbase-client`
- `npm/@trailbase-apps-in-toss-kit/trailbase-runtime`

The two Rust WASM helper crates are configured as a fixed group in `.sampo/config.toml` so they move
together. The Bun mTLS proxy and shared JS packages are private npm packages; Sampo manages their
versions and changelogs, but they are not published to npm. The proxy GHCR image release version
comes from `services/toss-mtls-client-proxy/package.json`.

## Regular Change Flow

```bash
sampo add
bun run sampo:release-notes:draft
```

Use `bun run sampo:release-notes:draft` before merging a feature PR when preparing a PR summary,
GitHub Release body, or operator handoff note. The draft command reads pending changesets without
consuming them.

After changesets land on `main`, the `Sampo release` workflow runs Sampo in `auto` mode and opens or
refreshes the release PR on `release/main`. Review that generated release PR for package version
bumps and changelog output, then merge it to publish the release commit. Use a manual local
`sampo release` only for release recovery or when the workflow is unavailable.

Configure `SAMPO_RELEASE_TOKEN` as a repository secret with a fine-grained PAT or GitHub App token
that can write contents and pull requests. The workflow falls back to `github.token`, but PRs created
with the default token may not trigger downstream pull request checks.

For proxy changes, target the private npm package:

```md
---
npm/@trailbase-apps-in-toss-kit/toss-mtls-client-proxy: patch
---

Describe the proxy change.
```

See [sampo-release-notes.md](sampo-release-notes.md) for changeset writing rules, release-note
drafting guidance, and consumer-repo usage.

## Proxy Image Release Flow

After the Sampo release PR bumps the proxy package version and the release commit lands on `main`,
the GHCR image workflow reads `services/toss-mtls-client-proxy/package.json`. If
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
