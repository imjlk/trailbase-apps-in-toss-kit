# TrailBase v0.33.16

- Published at: 2026-09-14T12:18:38Z
- Release URL: https://github.com/trailbaseio/trailbase/releases/tag/v0.33.16

## Release notes

- Add "Sign-in with Apple" support for native Mac/iOS applications. Thanks @yurvon-screamo 🙏
- Fix policy fallback for `UserIdentifier::UNDEFINED`. Now treat it as `ONLY_EMAIL` consistently. If you were relying on the behavior of the implicit fallback policy, i.e. to allow external users w/o an email address, simply set an explicit policy like `REQUIRE_USERNAME`.
- Fix Apple OAuth flow. Thanks @yurvon-screamo 🙏
- Fix `pageSize` persistence in admin UI's table explorer. Thanks @brigon-dev 🙏
- Update dependencies.


## What's Changed
* Fix table explorer resetting page size on sort/filter by @brigon-dev in https://github.com/trailbaseio/trailbase/pull/290
* Pr/native apple signin by @ignatz in https://github.com/trailbaseio/trailbase/pull/288

## New Contributors
* @brigon-dev made their first contribution in https://github.com/trailbaseio/trailbase/pull/290

**Full Changelog**: https://github.com/trailbaseio/trailbase/compare/v0.33.15...v0.33.16