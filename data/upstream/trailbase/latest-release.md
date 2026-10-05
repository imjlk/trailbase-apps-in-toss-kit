# TrailBase v0.34.4

- Published at: 2026-10-05T05:02:47Z
- Release URL: https://github.com/trailbaseio/trailbase/releases/tag/v0.34.4

## Release notes

- Add and enforce uniqueness requirement across `email` and `unverified_email` columns.
- Add periodic clean-up job for stale users missing email verification.
- Add missing username uniqueness requirement and fix session cleanup for experimental PG setup.
- Fix JSON schema construction for nullable `ANY` columns.
- A more consistent integration test setup across the 8 client environments.
- Update dependencies.


**Full Changelog**: https://github.com/trailbaseio/trailbase/compare/v0.34.3...v0.34.4