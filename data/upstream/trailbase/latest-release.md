# TrailBase v0.34.2

- Published at: 2026-09-30T19:16:18Z
- Release URL: https://github.com/trailbaseio/trailbase/releases/tag/v0.34.2

## Release notes

- Push expensive password hashing off the async runtime and add an explicit timeout of 5s.
  - Add test coverage for the flooded logins.
- Use exponential moving average plus some randomness to better handle the password-hash equivalent wait in the missing-user case.
- Update dependencies.


**Full Changelog**: https://github.com/trailbaseio/trailbase/compare/v0.34.1...v0.34.2