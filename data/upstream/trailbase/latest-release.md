# TrailBase v0.28.5

- Published at: 2026-06-12T12:28:39Z
- Release URL: https://github.com/trailbaseio/trailbase/releases/tag/v0.28.5

## Release notes

- Fix TOTP update query - thanks @zyrakq 🙏. This was a regression from the PG work.
- Point vendored dependencies at git to simplify library builds of TB itself - thanks @zyrakq 🙏.
- Update dependencies. Also point `serde_rusqlite` back at upstream.


## What's Changed
* fix: remove escaped quotes in register_totp_confirm UPDATE query by @zyrakq in https://github.com/trailbaseio/trailbase/pull/243

## New Contributors
* @zyrakq made their first contribution in https://github.com/trailbaseio/trailbase/pull/243

**Full Changelog**: https://github.com/trailbaseio/trailbase/compare/v0.28.4...v0.28.5