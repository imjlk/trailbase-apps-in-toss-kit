# TrailBase v0.30.0

- Published at: 2026-07-02T08:26:40Z
- Release URL: https://github.com/trailbaseio/trailbase/releases/tag/v0.30.0

## Release notes

- Merge `api::serve()` and `Server::init*` APIs by pulling out `AppState` construction and allowing injection of custom axum routers. This facilitates greater re-use between the `trail` binary and custom binaries. This is a breaking API change for users with custom binaries.
  - Historically, we haven't always pushed a major version but since numbers are cheap and we don't currently publish a separately versioned library crate, this is probably most explicit.
- Update auth documentation to talk about usernames and anonymous auth.
- Fix: scrollbars on admin dash's account page. Thanks @zyrakq 🙏.
- Update dependencies.


**Full Changelog**: https://github.com/trailbaseio/trailbase/compare/v0.29.0...v0.30.0