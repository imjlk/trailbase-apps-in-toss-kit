# TrailBase v0.35.7

- Published at: 2026-10-28T20:26:24Z
- Release URL: https://github.com/trailbaseio/trailbase/releases/tag/v0.35.7

## Release notes

- Enable HTTP2 negotiation to allow Browsers to multiplex more SSE streams.
- Untangle WASM SQLite extension function runtime from WASM HTTP handlers and tidy up implementation. Properly wire binary version to SQLite function initialization.
- Refine shutdown order: drop more sooner.
- Update dependencies.


**Full Changelog**: https://github.com/trailbaseio/trailbase/compare/v0.35.6...v0.35.7