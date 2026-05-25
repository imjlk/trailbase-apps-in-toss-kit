---
applyTo: "AGENTS.md,apps/trailbase/**,vendor/trailbase-apps-in-toss-kit/**,skills/trailbase-ops/**"
---

# TrailBase Ops

Use `skills/trailbase-ops/SKILL.md` as the canonical skill source. Load
`skills/trailbase-ops/references/trailbase-ops.md` for detailed guardrails when
working on TrailBase migrations, auth principal mapping, Record API ACL, WASM
guests, Coolify deployment, fresh-start behavior, or mTLS proxy settings.

- Prefer additive, forward-only migrations.
- Do not rewrite baseline SQL for production-like data unless the task is an
  explicit reset.
- Keep anonymous AppsInToss users mapped to TrailBase `_user` via official auth
  tokens and enforce disabled app auth states in WASM endpoints.
- Verify `config.textproto` when Record API access changes.
- Run the repo's `wasm32-wasip2` check after Rust WASM changes.
- Keep Toss mTLS certificates private to the proxy container.
