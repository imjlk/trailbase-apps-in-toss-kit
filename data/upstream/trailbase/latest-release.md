# TrailBase v0.28.4

- Published at: 2026-06-09T08:09:29Z
- Release URL: https://github.com/trailbaseio/trailbase/releases/tag/v0.28.4

## Release notes

- Wire up graceful server shutdown with realtime subscriptions, i.e. actively cancel established streams to prevent graceful shutdown from timing out.
- Update dependencies -  including wasmtime v44 -> v45 after addressing zero-duration timer issue upstream.


**Full Changelog**: https://github.com/trailbaseio/trailbase/compare/v0.28.3...v0.28.4