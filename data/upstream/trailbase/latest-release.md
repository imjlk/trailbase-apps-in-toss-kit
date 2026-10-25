# TrailBase v0.35.2

- Published at: 2026-10-21T17:02:14Z
- Release URL: https://github.com/trailbaseio/trailbase/releases/tag/v0.35.2

## Release notes

- Fix graceful DB shutdown for busy backlogs and extend wait time to allow logs to be written safely. This came to light as a result of increased throughput.
- Tidy up `User` and `DbUser` memory representations resulting in ~5% throughput increases. As we keep pushing, even small optimizations start to matter.
- Expand `trail migration` CLI command allowing to apply migrations w/o starting the server.
- Update dependencies. Address Wasmtime's security advisories.


**Full Changelog**: https://github.com/trailbaseio/trailbase/compare/v0.35.1...v0.35.2