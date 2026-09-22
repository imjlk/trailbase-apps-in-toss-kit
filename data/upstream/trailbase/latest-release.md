# TrailBase v0.33.20

- Published at: 2026-09-19T13:49:23Z
- Release URL: https://github.com/trailbaseio/trailbase/releases/tag/v0.33.20

## Release notes

- Implement more robust schema (tables, views, ...) name handling, i.e robustly parse escaped/unescpaed as well as unqualified/qualified names both on the server and in the admin UI.
  - This was an issue during config parsing and using the admin APIs, not API access.
  - Finally APIs can make use of tables with emojis in their names 🎉
- Admin UI: fix unnecessary editor scrollbars on mobile when the on-screen keyboard is up.
- Admin UI: fix API default names and post-create dirty state.
- Admin UI: fix cleanup of ephemeral columns during table creation.
- Upgrade WASM guest runtime for Rust to latest `wstd` and do some opportunistic API cleanups.
- Add more benchmarks for record listings and subscriptions.
- Update dependencies.


**Full Changelog**: https://github.com/trailbaseio/trailbase/compare/v0.33.19...v0.33.20