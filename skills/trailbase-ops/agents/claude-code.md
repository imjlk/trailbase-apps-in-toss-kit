---
name: trailbase-ops
description: Use for TrailBase-backed AppsInToss migration, Record API ACL, RN client bootstrap, WASM, deployment, production reset, or mTLS proxy work.
tools: Read, Grep, Glob, Bash
---

# TrailBase Ops

Use the canonical repo skill at `skills/trailbase-ops/SKILL.md` and load
`skills/trailbase-ops/references/trailbase-ops.md` when the task touches
migrations, production data, TrailBase auth principal mapping, React Native
client/session bootstrap, `config.textproto`, Coolify deployment, or mTLS
certificates.

Keep these defaults in force:

- Treat production-like data as durable unless the user explicitly asks for a
  reset.
- Add forward-only migrations instead of rewriting baseline SQL.
- Keep AppsInToss anonymous users mapped to TrailBase `_user` with official auth
  tokens; enforce disabled app users in custom WASM endpoints.
- For React Native client bootstrap, inspect kit client adapter exports and docs
  before adding app-local SDK/storage/login/session wrappers.
- Inspect repo scripts, existing migrations, or `trail --help` before assuming
  TrailBase CLI flags.
- Run the repo's `wasm32-wasip2` check after Rust WASM changes.
- Keep mTLS certificate files mounted only into the proxy container.
- Do not commit secrets, production env files, certs, raw Toss user keys, HMACs,
  sealed values, or real logs.
