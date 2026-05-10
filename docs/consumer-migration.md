# Consumer Migration Guide

Follow this when migrating an existing TrailBase-backed AppsInToss project to the shared kit.

1. Add `vendor/trailbase-apps-in-toss-kit` as a submodule.
2. Replace `apps/toss-mtls-proxy` with the shared `toss-mtls-client-proxy` service.
3. Keep existing Toss adapter paths so current WASM callers keep working.
4. Remove endpoint path override envs:
   - `TOSS_PROMOTION_GET_KEY_PATH`
   - `TOSS_PROMOTION_EXECUTE_PATH`
   - `TOSS_PROMOTION_RESULT_PATH`
   - `TOSS_LOGIN_GENERATE_TOKEN_PATH`
   - `TOSS_LOGIN_ME_PATH`
5. Rename service references from `toss-mtls-proxy` to `toss-mtls-client-proxy`.
6. Run proxy stub smoke, TrailBase Toss smoke, and production release checks.
