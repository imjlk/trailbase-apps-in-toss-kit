# TrailBase Upstream Tracking

This repository is a reusable AppsInToss integration kit for TrailBase-backed
services. It does not vendor the TrailBase server. TrailBase server, client,
runtime, and Rust toolchain changes are tracked as upstream compatibility
inputs.

## Official Upstream Sources

- GitHub repository: https://github.com/trailbaseio/trailbase
- GitHub releases: https://github.com/trailbaseio/trailbase/releases
- CHANGELOG: https://raw.githubusercontent.com/trailbaseio/trailbase/main/CHANGELOG.md
- Website/docs: https://trailbase.io/

## Compatibility Policy

These values are policy values for this kit.

- Kit minimum supported TrailBase server: `TBD`
- Last verified TrailBase server: `0.28.5`
- Last verified TrailBase release date: `2026-06-12`
- Upstream latest TrailBase server: `0.28.6`
- Upstream latest TrailBase release date: `2026-06-17`
- Upstream Rust MSRV/MVRV from release notes: `1.93`
- Upstream Rust toolchain from release notes: `1.95`

Do not automatically raise the kit minimum supported TrailBase server. Raise it
only after consumer-app smoke tests pass.

The manual server compatibility values are mirrored in
`data/trailbase-compat-policy.json`. That file is intentionally not generated
from the upstream latest release, because latest upstream and supported-by-this-kit
are different signals.
TrailBase `0.28.6` is currently tracked as upstream latest, but the last verified
kit policy remains `0.28.5` until kit and consumer smoke tests pass.

Rust tool versions are surfaced in both `.mise.toml` and `rust-toolchain.toml`.
`mise` is the preferred developer entrypoint for installing the repo toolchain,
while `rust-toolchain.toml` keeps Cargo, rustup, editors, and CI compatible with
standard Rust project behavior.

After pulling a new `.mise.toml`, run `mise trust` once for this checkout, then
`mise install` to install the pinned tools.

## Renovate-Tracked Upstream Versions

<!-- renovate: datasource=github-releases depName=trailbaseio/trailbase extractVersion=^v(?<version>.*)$ versioning=semver -->
- `trailbase-server-github-release`: `0.28.6`

<!-- renovate: datasource=crate depName=trailbase-wasm versioning=cargo -->
- `trailbase-wasm`: `0.5.1`

<!-- renovate: datasource=crate depName=trailbase-client versioning=cargo -->
- `trailbase-client`: `0.8.1`

<!-- renovate: datasource=npm depName=trailbase versioning=npm -->
- `trailbase-js-client`: `0.12.1`

If you edit these Renovate marker blocks or `renovate.json`, validate the
configuration with `bun run renovate:validate`. The command installs the
Renovate validator through `npx` for that run, so the validator does not need to
be committed as a dependency.

## Release Watch Outputs

The `TrailBase release watch` workflow writes upstream snapshots to:

- `data/upstream/trailbase/latest-release.md`
- `data/upstream/trailbase/version-policy.json`

The snapshot script reads the latest GitHub release first. If the release notes
do not mention Rust policy, it falls back to the newest matching TrailBase
CHANGELOG section that mentions Rust MSRV/MVRV or toolchain changes.

Configure a repo secret named `TRAILBASE_RELEASE_WATCH_TOKEN` before relying on
the scheduled release-watch workflow. Use a fine-grained PAT or GitHub App token
that can push branches and open pull requests for this repository. The workflow
uses this non-default token so generated PRs trigger downstream `pull_request`
checks automatically. If the secret is missing, the workflow fails fast instead
of opening a PR with no automatic CI.

## Consumer Server Version Advisory

Consumer apps own their copied Docker Compose files and TrailBase server image
tags. This kit therefore does not fail CI just because a consumer is behind
upstream latest. Older versions can be valid when the app has pinned and tested
them.

Use the advisory checker from a consumer app when you want CI or a deployment
runbook to surface the relationship between that app's TrailBase server tag and
this kit's manual policy:

```bash
node vendor/trailbase-apps-in-toss-kit/scripts/check-trailbase-version-policy.mjs \
  --compose docker-compose.yml

node vendor/trailbase-apps-in-toss-kit/scripts/check-trailbase-version-policy.mjs \
  --image trailbaseio/trailbase:0.28.5

CI_STRICT=1 node vendor/trailbase-apps-in-toss-kit/scripts/check-trailbase-version-policy.mjs \
  --version 0.28.5
```

In non-strict mode the script warns and exits successfully. In strict mode it
fails only when it can see a concrete policy violation, such as a version below
the declared kit minimum, a version newer than the last verified version, or a
moving/unparseable server image tag. If the kit minimum is still `TBD`, the
script skips the minimum-version gate while still checking the last verified
upper bound.

## Review Checklist When TrailBase Changes

- Check release notes for breaking API behavior.
- Check Record API, auth, realtime subscription, WASM runtime, and auth-ui notes.
- Check whether TrailBase raised Rust MSRV/MVRV or toolchain.
- Run Rust WASM guest checks against the policy toolchain.
- Run consumer smoke tests with a real or stub TrailBase instance.
- Update templates only after compatibility is verified.
