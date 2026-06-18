---
name: trailbase-ops
description: Use when working on TrailBase-backed AppsInToss services, including SQL migrations, baseline reset decisions, Record API ACL/config.textproto changes, Rust WASM guests, React Native client bootstrap adapters, Coolify deployments, production checks, fresh-start handling, or mTLS proxy operations.
---

# TrailBase Ops

## Overview

Use this skill to keep TrailBase schema, WASM, Record API, client bootstrap, deployment, and mTLS
proxy work safe across AppsInToss services.

For detailed guardrails, load [references/trailbase-ops.md](references/trailbase-ops.md) when a task
touches migrations, production data, auth principal mapping, React Native client/session bootstrap,
`config.textproto`, Coolify deployment, or mTLS certificates.

This skill is not the source of truth for Apps in Toss SDK/API documentation.
For Apps in Toss, Toss Login, IAP, Promotion, Smart Message, notification agreement,
`requestNotificationAgreement`, Granite, Bedrock, TDS, or review-policy questions, first discover
available Apps in Toss MCP/CLI/docs tooling and search official Korean docs with concise Korean
keywords. Use this skill after that when the same work changes TrailBase schema/config, WASM,
templates, deployment, or the mTLS proxy boundary.

## Workflow

1. Decide whether production or production-like data may exist.
2. If data should be preserved, do not rewrite baseline migrations. Add a forward-only migration.
3. If the user explicitly wants a baseline reset, confirm that data compatibility is intentionally
   discarded before changing baseline SQL or fresh-start behavior.
4. If Record API exposure changes, update `config.textproto` and run the repo ACL/prod checks.
5. If auth flow changes, preserve the TrailBase `_user` principal path and official auth token flow;
   do not add custom app-owned `users` auth tables.
6. If React Native client bootstrap changes, inspect existing kit client adapters before writing
   app-local SDK/storage/login wrappers. Prefer exported kit helpers and update this skill/reference
   when new reusable helper APIs are added.
7. If Rust WASM changes, run the repo's `wasm32-wasip2` check.
8. If deployment or proxy settings change, verify production env, Compose shape, and mTLS certificate
   mount boundaries.

## TrailBase CLI

Prefer repo scripts or TrailBase CLI helpers when creating migrations, but inspect `trail --help`,
repo scripts, or existing migrations before assuming exact command flags. When no safe generator is
available, create a migration that follows the repo's existing filename/version pattern.

Consumer repos should normally keep only `apps/trailbase/traildepot-template` as the Git-tracked
schema/config source of truth. Do not add tracked `traildepot` symlinks by default; `traildepot` is
runtime output and should stay ignored.

When a developer needs the TrailBase CLI, prefer a root `package.json` alias that runs the CLI inside
the TrailBase Docker container instead of using a host-installed binary. The recommended alias is
`bun trail -- ...`, wrapping `docker compose exec trailbase /app/trail --data-dir /app/traildepot ...`.
Keep Git-tracked schema/config source in `traildepot-template`; do not add host-side `traildepot`
symlinks by default.

## Safety Defaults

- Baseline SQL is immutable after production starts unless the task is explicitly a reset.
- Additive migrations should be forward-only and safe to re-run through TrailBase's migration engine.
- TrailBase is a SQLite single-writer service; avoid rolling updates and default to service recreate.
- AppsInToss anonymous users should bootstrap into TrailBase `_user`, then receive tokens through the
  official auth login flow; do not mint JWTs or write `_session` rows directly.
- Toss Login sandbox referrers are real SDK outputs, not local-stub markers. If
  `TOSS_LOGIN_MODE=proxy` or `forward`, route `referrer=SANDBOX` authorization codes through the
  mTLS proxy/forward exchange. Restrict local stubs to explicit `TOSS_LOGIN_MODE=stub` or
  simulator-only `dev-*` authorization codes. In Rust WASM consumers, use
  `trailbase_guest_common::apps_in_toss_login::normalize_login_referrer` when forwarding the
  referrer; do not hand-roll uppercase/lowercase normalization.
- If an app tracks `profiles.auth_state` or another domain auth-state field, enforce `disabled` in
  custom WASM endpoints as well as in bootstrap alias handling.
- For TrailBase-backed React Native apps, prefer kit client adapters over app-local SDK wrappers for
  anonymous identity, Apps in Toss storage, session management, login normalization, notification
  agreement normalization, and any future helper category exported by the kit. Do not import planned
  helper names until they exist; first inspect package exports and client-adapter docs.
- mTLS certificates mount only into the proxy container, never into TrailBase or app containers.
- Secrets, production env files, certs, raw Toss user keys, HMACs, sealed values, and real logs are
  never committed.
