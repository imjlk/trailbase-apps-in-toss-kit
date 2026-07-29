# TrailBase v0.31.1

- Published at: 2026-07-25T15:22:07Z
- Release URL: https://github.com/trailbaseio/trailbase/releases/tag/v0.31.1

## Release notes

- Add username parsing to CLI, i.e. users can now be specified by either email, username or id (both UUID or url-safe base64).
- Mark `--data-dir`/`$DATA_DIR` as deprecated in favor of `--depot`/`$DEPOT`.
- Add transaction/batch support to Swift client.
- Minor: fix theme switchers button style on first load. Thanks @zyrakq.
- Minor: reduce log level for CLI when not running the server.
- Update dependencies.


## What's Changed
* Fix theme toggle icon showing wrong state on initial load by @zyrakq in https://github.com/trailbaseio/trailbase/pull/264


**Full Changelog**: https://github.com/trailbaseio/trailbase/compare/v0.31.0...v0.31.1