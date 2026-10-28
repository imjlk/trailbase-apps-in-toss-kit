# TrailBase v0.35.6

- Published at: 2026-10-27T18:08:08Z
- Release URL: https://github.com/trailbaseio/trailbase/releases/tag/v0.35.6

## Release notes

- Add `X-Accel-Buffering=no` header to SSE connections to simplify reverse-proxy configuration and accidental buffering, which may delay events. @rb365 🙏
- Avoid truncating SQLite WALs on implicit connection closure. In multi-DBs setups, we don't want to interfere with other connections when a cached connection is evicted.
- Add explicit DB shutdown order to avoid an issues w/o implicit destruction even though it was working just fine.
- Internal: remove PGLite in favor of `testcontainers`.
- Update dependencies.


**Full Changelog**: https://github.com/trailbaseio/trailbase/compare/v0.35.5...v0.35.6