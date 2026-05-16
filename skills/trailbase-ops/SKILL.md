---
name: trailbase-ops
description: Use when working on TrailBase-backed AppsInToss services, including SQL migrations, baseline reset decisions, Record API ACL/config.textproto changes, Rust WASM guests, Coolify deployments, production checks, fresh-start handling, or mTLS proxy operations.
---

# TrailBase Ops

## Overview

Use this skill to keep TrailBase schema, WASM, Record API, deployment, and mTLS proxy work safe
across AppsInToss services.

For detailed guardrails, load [references/trailbase-ops.md](references/trailbase-ops.md) when a task
touches migrations, production data, `config.textproto`, Coolify deployment, or mTLS certificates.

## Workflow

1. Decide whether production or production-like data may exist.
2. If data should be preserved, do not rewrite baseline migrations. Add a forward-only migration.
3. If the user explicitly wants a baseline reset, confirm that data compatibility is intentionally
   discarded before changing baseline SQL or fresh-start behavior.
4. If Record API exposure changes, update `config.textproto` and run the repo ACL/prod checks.
5. If Rust WASM changes, run the repo's `wasm32-wasip2` check.
6. If deployment or proxy settings change, verify production env, Compose shape, and mTLS certificate
   mount boundaries.

## TrailBase CLI

Prefer repo scripts or TrailBase CLI helpers when creating migrations, but inspect `trail --help`,
repo scripts, or existing migrations before assuming exact command flags. When no safe generator is
available, create a migration that follows the repo's existing filename/version pattern.

## Safety Defaults

- Baseline SQL is immutable after production starts unless the task is explicitly a reset.
- Additive migrations should be forward-only and safe to re-run through TrailBase's migration engine.
- TrailBase is a SQLite single-writer service; avoid rolling updates and default to service recreate.
- mTLS certificates mount only into the proxy container, never into TrailBase or app containers.
- Secrets, production env files, certs, raw Toss user keys, HMACs, sealed values, and real logs are
  never committed.
