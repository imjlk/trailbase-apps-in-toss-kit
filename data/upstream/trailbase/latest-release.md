# TrailBase v0.28.0

- Published at: 2026-05-28T22:35:36Z
- Release URL: https://github.com/trailbaseio/trailbase/releases/tag/v0.28.0

## Release notes

- Experimental Postgres support 🎉
  - For context, this is not an effort to replace SQLite but rather to provide options.
    SQLite will remain the recommend default due to its speed and simplicity aligning best with TrailBase's mission of offering a cheap & easily self-hostable stack.
  - Yet, some user may want to use Postgres due to personal preference, very write-heavy workloads or needing some of Postgres' plentiful features.
  - Note that offering transparent, hands-off migrations between SQLite and Postgres is a non-goal.
    Their data formats, dialects, feature sets, ... are just too different. However Postgres support can provide a path forward for folks with evolving requirements.
  - You can try it out with a locally running Postgres instance, simply by running:
    `trail run --experimental-pg=postgresql://<user>:<pass>@localhost:<port>/<db>`
  - Some of the known idiosyncrasies and limitation include:
    - No realtime subscriptions. Endpoint is not registered and config validation will fail.
    - No UI-driven schema manipulation/migrations - UI elements are disabled.
    - No custom JSON schemas.
    - No multi-DB or custom DB schemas beyond "public".
    - Logs and session data will remain in SQLite separate databases for now.
    - Geo/PostGIS functionality is untested, mostly due to our testing setup with `pglite-oxide` not supporting it.
    - Expect many non-trivial PG types to not work yet. The translations from and to JSON may be missing.
    - Differences in the SQL dialect, which may surface in migrations or ACLs. For example:
      - `IN _REQ_FIELDS_` operator => `IN (SELECT * FROM _REQ_FIELDS_)`.
      - Unlike SQLite, Postgres only accepts `"` for escaping.
    - PG connections do not yet support TLS.
    - The PG connection-pooling/execution has not yet been optimized.
  - If you end up checking it out and run into any issues, don't hesitate to reach out 🙏.
- Remove `ROLLBACK` and `FAIL` conflict resolution strategies during record insertions.
  - Their behavior in the context of batch operations and transactions wasn't well defined.
  - If you used any of the above strategies, this will require you to edit your config.
- Consistently switch from the SQLite-specific insert `ConflictResolutionStrategy` to ISO upsert clauses.
  - If you've defined additional uniqueness constraints on your tables, besides PK, the new upsert may be more strict.
- Minor: fix admin UI ERG issue when no `TABLE`s/`VIEW`s exist yet.
- Update dependencies (downgrade Wasmtime v45->v44, there's an issue that requires further debugging).


**Full Changelog**: https://github.com/trailbaseio/trailbase/compare/v0.27.9...v0.28.0