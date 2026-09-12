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
- Last verified TrailBase server: `0.33.14`
- Last verified TrailBase release date: `2026-09-10`
- Upstream latest TrailBase server: `0.33.14`
- Upstream latest TrailBase release date: `2026-09-10`
- Upstream Rust MSRV/MVRV from release notes: `1.93`
- Upstream Rust toolchain from release notes: `1.95`

Do not automatically raise the kit minimum supported TrailBase server. Raise it
only after consumer-app smoke tests pass.

The manual server compatibility values are mirrored in
`data/trailbase-compat-policy.json`. That file is intentionally not generated
from the upstream latest release, because latest upstream and supported-by-this-kit
are different signals.
TrailBase `0.33.14` is now the last version verified with the disposable kit
WASM/auth/Record API/SSE fixture. Run `bun run trailbase:wasm:smoke` to reproduce
it with Docker. The smoke uses explicit proxy stub mode and never touches a
consumer checkout or deployment. Consumer device and production checks remain
app-owned; the kit minimum stays TBD.

Rust tool versions are surfaced in both `.mise.toml` and `rust-toolchain.toml`.
`mise` is the preferred developer entrypoint for installing the repo toolchain,
while `rust-toolchain.toml` keeps Cargo, rustup, editors, and CI compatible with
standard Rust project behavior.

After pulling a new `.mise.toml`, run `mise trust` once for this checkout, then
`mise install` to install the pinned tools.

## Renovate-Tracked Upstream Versions

<!-- renovate: datasource=github-releases depName=trailbaseio/trailbase extractVersion=^v(?<version>.*)$ versioning=semver -->
- `trailbase-server-github-release`: `0.33.14`

<!-- renovate: datasource=crate depName=trailbase-wasm versioning=cargo -->
- `trailbase-wasm`: `0.6.1`

<!-- renovate: datasource=crate depName=trailbase-client versioning=cargo -->
- `trailbase-client`: `0.10.1`

<!-- renovate: datasource=npm depName=trailbase versioning=npm -->
- `trailbase-js-client`: `0.14.1`

If you edit these Renovate marker blocks or `renovate.json`, validate the
configuration with `bun run renovate:validate`. The command installs the
Renovate validator through `npx` for that run, so the validator does not need to
be committed as a dependency.

## Reviewed Compatibility Delta

- `0.29.0` adds username-based and anonymous auth, makes `_user.email`
  case-insensitive, and stops normalizing email values. The kit continues to
  map Apps in Toss identities to TrailBase `_user`; consumer auth smoke tests
  should cover existing synthetic identities and session bootstrap.
- `0.30.0` changes the custom Rust server construction API. This kit does not
  ship a custom TrailBase server binary, but consumers that do must update their
  `api::serve()` or `Server::init*` integration.
- `0.31.0` changes batch/transaction Record API responses to return one result
  per operation. Consumers using those APIs must update response parsing.
- `0.31.1` deprecates `--data-dir`/`DATA_DIR` in favor of `--depot`/`DEPOT`.
  The kit runtime intentionally keeps the accepted legacy `--data-dir` spelling
  for compatibility with older servers such as `0.28.6`; switch the runtime
  command only after the minimum supported server is raised past versions that
  lack `--depot`.
- The latest Rust client is `0.10.1`, the latest JS client is `0.14.1`, and
  `trailbase-wasm` is now `0.6.1`. The kit's optional JS peer range
  `>=0.12.1 <1` already admits `0.14.1`.

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
  --image trailbase/trailbase:0.33.14

CI_STRICT=1 node vendor/trailbase-apps-in-toss-kit/scripts/check-trailbase-version-policy.mjs \
  --version 0.33.14
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

## Guest ABI and Auth Migration

TrailBase 0.32 changed the component interface. This checkout now builds with
`trailbase-wasm` 0.6.1 and must be deployed together with a compatible server;
0.33.14 is the verified pairing. Rebuild all consumer Rust components and update
the first-party auth-ui component following the upstream component instructions.
Keep a consumer on its previous kit/server pair until that coordinated migration
is ready. The unchanged TBD minimum policy is not a claim that new components run
on pre-0.32 servers.

TrailBase 0.31.2 replaced `_user.verified` with a separate `unverified_email`
column; non-null `email` now represents a verified address. The kit detects the
schema inside the transaction. Legacy helpers still use the verified flag; modern
helpers write the verified service email directly and can promote an existing
unverified-only service principal without resetting its password. They do not
overwrite a verified account's pending email change or silently choose between
ambiguous unverified service identities. Official login and password rotation
remain the token authority.

The reviewed upstream delta also includes nested JSON subscription fixes in
0.31.3, recycled Rust guest state and auth-ui metadata changes in 0.32, stronger
refresh-token entropy and OAuth/cookie fixes in 0.33, and admin UI/SQL tooling
changes through 0.33.14. No Postgres compatibility claim is added; this kit's SQL
and integration smoke remain SQLite-based. Keep request/user state out of global
Rust guest caches because guest instances may serve multiple requests.

The CI smoke compiles `compat_smoke` only with the explicit `compat-smoke` feature,
starts disposable Docker containers on a private network with a loopback host
port, applies the functional-ledger templates, checks auth/ACL/SSE, and removes its
containers/network/depot afterward. Never install this fixture in a real service.
It does not validate actual Toss certificates, purchases, auth-ui UX, or a
consumer's full application migrations.
