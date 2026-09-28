# TrailBase v0.33.22

- Published at: 2026-09-23T16:46:17Z
- Release URL: https://github.com/trailbaseio/trailbase/releases/tag/v0.33.22

## Release notes

- Fix behavior when a Rust WASM guest panics:
  - Respond right away with the error w/o relying on a timeout.
  - Remove trapped component from shared instance pool to avoid poisoning.
- Add support for SQL `execute_batch` to JS/TS WASM guests.
- Add integration test coverage for JS/TS WASM components. Still needs to be enabled in CI.
- Overhaul integration tests.
- Update dependencies.


**Full Changelog**: https://github.com/trailbaseio/trailbase/compare/v0.33.21...v0.33.22