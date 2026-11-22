# TrailBase v0.36.1

- Published at: 2026-11-18T16:35:29Z
- Release URL: https://github.com/trailbaseio/trailbase/releases/tag/v0.36.1

## Release notes

- Add `ProxyConfig` to allow configuring a known trusted (reverse-)proxy topology. This allows for narrower, more correct and safer extraction of client IPs from proxy-provded headers.
  - For example, if you have a chain of multiple proxies you can configure TB to use the right-most `X-Forwarded-For` non-proxy IP for logging and rate limiting.
- Admin UI: persist `ERD` graph node positions.
- Update Rust and JavaScript dependencies. Addresses security advisories.


**Full Changelog**: https://github.com/trailbaseio/trailbase/compare/v0.36.0...v0.36.1