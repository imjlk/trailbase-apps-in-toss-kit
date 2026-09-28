# @trailbase-apps-in-toss-kit/release-tools

## 0.2.0 — 2026-09-28

### Minor changes

- [eb4b23d](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/eb4b23dc3fe6a56016006cf8da5b4c81650af430) Add an optional snapshotMaxRecords guard that rejects oversized collection snapshots before reconciliation. Clarify full replacement versus single-page merging without changing defaults. Add a read-only Bun/Cargo release dependency guard that permits workspace version changes and rejects unrelated lockfile drift before publishing.
  
  Adopt @ait-kit/sdk 0.5.1 with explicit React Native export conditions so consumers can remove their SDK package export patches. — Thanks @imjlk!

## 0.1.0 — 2026-09-13

### Minor changes

- [0d3c539](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/0d3c539e893970a3a8c64da1c223418273374418) Add build-time release helpers for RN consumer apps: discover every package in the app's Sampo fixed group, verify stable lockstep versions, synchronize only local Cargo package versions, and generate deduplicated release notes. Validate the packaged AIT bytes, production settings, supported runtime/platform bundles, source commit and tag before uploading an explicit artifact with redacted CLI failures. Consumers retain their app settings, SDK runtime policy, secrets and workflow triggers; these tools do not publish private packages or deploy TrailBase. — Thanks @imjlk!

