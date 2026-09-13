# Consumer AIT releases

`@trailbase-apps-in-toss-kit/release-tools` provides build-time helpers for a
consumer's Sampo release and Apps in Toss upload. Add
`vendor/trailbase-apps-in-toss-kit/packages/release-tools` to the consumer's Bun
workspaces and a `workspace:*` dev dependency where its release scripts live.
This private package is consumed through the submodule; it is not published to npm.

Use **Bun 1.4.2 or later** for Sampo discovery and Cargo lock synchronization.
Those helpers use `Bun.TOML.parse`; the AIT-only helpers also work in Node.
Do not import this package into the RN application bundle.

## Sampo as the package inventory

```js
import {
  readSampoLockstep, planSampoRelease, syncCargoLockVersions,
  createSampoReleaseTag,
} from '@trailbase-apps-in-toss-kit/release-tools/sampo';

const release = { root: process.cwd(), appName: 'your-app', anchor: 'npm/@your-app/rn' };
const lockstep = readSampoLockstep(release);
const plan = planSampoRelease(release);
```

The anchor selects exactly one `.sampo/config.toml` fixed group. Every member
must have one tracked, explicitly versioned `package.json` or `Cargo.toml` and
the same stable SemVer. Missing packages and inherited Rust versions fail rather
than silently reducing coverage. `vendor/` is excluded from manifest discovery.
Configure Sampo's complete app group, including workers, jobs and internal crates.

When `plan.pending` is true, run Sampo's release PR automation. After Sampo
updates manifests, run `syncCargoLockVersions(release)` and
`bun install --lockfile-only --ignore-scripts`, then commit the changed locks to
the release PR. The Cargo helper updates local fixed-group package versions in
**all tracked Cargo.lock files**. It preserves registry packages and checksums;
ambiguous or version-qualified dependency references require Cargo regeneration.
It does not resolve dependency upgrades.

After the verified release PR merges, fetch full history and tags, check out
current `origin/main`, and configure the Git author. With no pending changesets,
`createSampoReleaseTag({ ...release, push: true })` creates an annotated
`your-app-vX.Y.Z` tag from a clean checkout. Existing tags are never moved.
`plan.tag` is empty if changesets or the expected tag already exist.

`renderSampoReleaseNotes({ root, appName, lockstep })` from the `/notes` export
combines the current version's package changelogs. It deduplicates complete
entries while preserving distinct multiline migration details. This complements
the existing [pending changeset draft](sampo-release-notes.md) command.

## Build evidence and upload

The `/ait` export provides `validatePublicBuildConfig`, `validateUploadRun`,
`readReleaseContext`, `inspectAitArtifact`, `buildConfigDigest`,
`validateReleaseEvidence`, and `uploadVerifiedAit`.

The consumer owns this sequence:

1. Validate a JSON object against its exact public setting names, production
   constants, HTTPS URL fields and required/optional ad fields. Keep API keys
   out of that object and out of the bundler process environment.
2. Read the complete Sampo lockstep version and fresh Git context. Build with
   the app's installed `ait` CLI. Inspect the actual `.ait` bytes using the
   registered `appName`, explicit expected JS runtime/platform entry names,
   public `config`, and `settingKeys` to verify in every JS bundle.
3. Persist a report containing the context, artifact inspection result,
   `configHash: buildConfigDigest(config)`, `fixture`, and `uploaded: false`.
   Fixture builds are useful for PRs but can never be uploaded.
4. At upload time, obtain fresh context with `requireTag: true`, re-read the
   public configuration, and call `uploadVerifiedAit` with `artifactPath`, the
   report, `context`, inspection `policy`, installed `cliPath`, `appRoot`, and
   `apiKey`. The tag must match the app/version, point at HEAD, and be reachable
   from fetched `origin/main`. Save the returned report after success.

Inspection rejects unexpected/missing runtimes, missing source maps, packaged
test ad IDs, wrong settings and bundles exceeding 100 MB expanded size. Upload
rechecks the actual artifact hash/deployment ID, source commit, version, tag,
configuration hash and clean production evidence before invoking the CLI with
the exact artifact path. CLI failure messages suppress captured output and
secret arguments. A timeout or unexpected response needs console inspection
before retrying; no local report can make a remote upload transactional.

## Consumer workflow responsibilities

Use separate PR fixture and tag upload jobs. Only the upload step receives the
Apps in Toss key. A manual run defaults to build-only; explicit uploads require
a tag and reject fixture mode. Keep release guard changes and their changeset
in the feature PR so Sampo generates an accurate release PR.

Tags pushed with `GITHUB_TOKEN` do not start a downstream push workflow. After
creating a new tag, explicitly dispatch the upload workflow at that tag. If a
bot-created release PR cannot start normal checks, dispatch its fixture run
and publish a commit status against the exact tested SHA; do not treat a branch
dispatch as a PR check automatically. Serialize uploads and retain the artifact,
report and workflow URL as release evidence.

The helper does not create workflow permissions, secrets, GitHub Releases,
TrailBase deployments, console submissions or device-test approval. The
consumer controls those operations. RN runtime support is an explicit policy;
adding this helper does not migrate an RN app to the WebView SDK.

References: [Apps in Toss upload and testing](https://developers-apps-in-toss.toss.im/guide/operation/toss),
[GitHub workflow triggers](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow).
