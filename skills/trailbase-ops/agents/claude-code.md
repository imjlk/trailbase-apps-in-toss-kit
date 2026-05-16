---
name: trailbase-ops
description: Use for TrailBase-backed AppsInToss migration, Record API ACL, WASM, deployment, production reset, or mTLS proxy work.
tools: Read, Grep, Glob, Bash
---

# TrailBase Ops

Use the canonical repo skill at `skills/trailbase-ops/SKILL.md` and load
`skills/trailbase-ops/references/trailbase-ops.md` when the task touches
migrations, production data, `config.textproto`, Coolify deployment, or mTLS
certificates.

Keep these defaults in force:

- Treat production-like data as durable unless the user explicitly asks for a
  reset.
- Add forward-only migrations instead of rewriting baseline SQL.
- Inspect repo scripts, existing migrations, or `trail --help` before assuming
  TrailBase CLI flags.
- Run the repo's `wasm32-wasip2` check after Rust WASM changes.
- Keep mTLS certificate files mounted only into the proxy container.
- Do not commit secrets, production env files, certs, raw Toss user keys, HMACs,
  sealed values, or real logs.
