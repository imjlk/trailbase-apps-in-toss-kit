---
trigger: model_decision
globs: "AGENTS.md,apps/trailbase/**,vendor/trailbase-apps-in-toss-kit/**,skills/trailbase-ops/**"
---

# TrailBase Ops

Use `skills/trailbase-ops/SKILL.md` as the canonical source. For detailed
policy, read `skills/trailbase-ops/references/trailbase-ops.md` when changing
TrailBase migrations, Record API ACL, Rust WASM guests, Coolify deployment,
fresh-start behavior, or mTLS proxy settings.

Default behavior:

- Add forward-only migrations unless the user explicitly requests a reset.
- Do not change baseline SQL for production-like data.
- Check `config.textproto` whenever Record API exposure changes.
- Run the repo's `wasm32-wasip2` check after WASM edits.
- Mount mTLS certificates only into the proxy service.
