# @trailbase-apps-in-toss-kit/release-tools

## 0.4.0 — 2026-10-04

### Minor changes

- [0f24aa0](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/0f24aa0d2e0102b654420baca6dd8794bb6b5f02) Add standalone local Cargo execution and read-only cache reporting tools. Share host targets, retain line-table debug information for routine checks, and support explicit full-debug and ephemeral modes without changing release profiles or global settings. Consumers may copy the standalone tools without updating runtime dependencies. Resolve artifact paths through Cargo metadata and stage Docker WASM within the locked cache-mount build step; review bounded BuildKit GC settings separately from application data volumes. — Thanks @imjlk!

## 0.3.0 — 2026-10-02

### Minor changes

- [da2e62a](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/da2e62a0dcf04d6929a53aa48e448e1683c359e5) Add opt-in read-only RN runtime snapshots, WebView OPTIONS preflight checks in Release Doctor, and artifact-bound device test scheme/plan builders. Logs exclude native errors, identity data and tokens. Tests remain explicitly unverified until run on the target device. Validate RN SDK 2.10.11 while retaining the 2.10.10 minimum compatibility fixture. No automatic SDK calls with side effects, CORS rewrites, bundle uploads or production deployment. — Thanks @imjlk!

## 0.2.0 — 2026-09-28

### Minor changes

- [eb4b23d](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/eb4b23dc3fe6a56016006cf8da5b4c81650af430) Add an optional snapshotMaxRecords guard that rejects oversized collection snapshots before reconciliation. Clarify full replacement versus single-page merging without changing defaults. Add a read-only Bun/Cargo release dependency guard that permits workspace version changes and rejects unrelated lockfile drift before publishing.
  
  Adopt @ait-kit/sdk 0.5.1 with explicit React Native export conditions so consumers can remove their SDK package export patches. — Thanks @imjlk!

## 0.1.0 — 2026-09-13

### Minor changes

- [0d3c539](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/0d3c539e893970a3a8c64da1c223418273374418) Add build-time release helpers for RN consumer apps: discover every package in the app's Sampo fixed group, verify stable lockstep versions, synchronize only local Cargo package versions, and generate deduplicated release notes. Validate the packaged AIT bytes, production settings, supported runtime/platform bundles, source commit and tag before uploading an explicit artifact with redacted CLI failures. Consumers retain their app settings, SDK runtime policy, secrets and workflow triggers; these tools do not publish private packages or deploy TrailBase. — Thanks @imjlk!

