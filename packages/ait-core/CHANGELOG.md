# @trailbase-apps-in-toss-kit/ait-core

## 0.2.0 — 2026-11-05

### Minor changes

- [d970562](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/d970562e4a1f243cc8154ebf76ed903c04644218) Share full-screen ad lifecycle, ad skip reconciliation, persisted JSON state,
  analytics and engagement helpers between RN and WebView adapters. WebView adds
  SDK 3 ad loading, DOM banner delegation, verbatim-key Storage and Analytics.log
  integration. Existing RN entry points and long-ad completion behavior remain.
  
  Consumers updating either adapter must register
  `vendor/trailbase-apps-in-toss-kit/packages/ait-core` alongside their adapter and
  `trailbase-client` in Bun workspaces, then regenerate their lockfile. The kit does
  not migrate screens or release consumer bundles. Validate fresh-code authentication,
  storage continuity, ads and skip receipts on devices before an SDK 3 rollout;
  SDK 3 releases cannot roll back to SDK 2.
  
  Include the shared client workspace manifest in filtered proxy image builds.
  Proxy runtime routes and certificate mounts are unchanged. — Thanks @imjlk!

