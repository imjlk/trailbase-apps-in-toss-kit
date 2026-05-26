# TrailBase v0.27.9

- Published at: 2026-05-25T11:42:08Z
- Release URL: https://github.com/trailbaseio/trailbase/releases/tag/v0.27.9

## Release notes

- Use `crossfire` channels in `trailbase_sqlite` execution model. They're supposedly faster than `kanal` but with select support like `flume` et al.
  - Synthetic benchmarks show a 5%-10% improvement, however whole program benchmarks are less conclusive.
- Expand PG Support:
  - Follow foreign key references.
  - Improve and fix shims around UUIDs.
  - Support PG `TID`s in `ToSql`
  - Fix issue with columns being bok PKs and FKs.
  - Make number conversions more consistent.
- Update dependencies including Wasmtime.


**Full Changelog**: https://github.com/trailbaseio/trailbase/compare/v0.27.8...v0.27.9