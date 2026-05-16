# Contributing

## Agent Skills

Repo-tracked agent skills live under `skills/`. Treat this directory as the
source of truth; local tool-specific skill entries should be synced from here.

Before opening a PR that adds or changes a skill, run:

```bash
bun run skills:validate
```

For local development, link skills into Codex:

```bash
bun run skills:sync
```

Claude Code and Cline can also be synced globally:

```bash
bun run skills:sync:claude
bun run skills:sync:cline
```

Project-scoped adapters use the generic Bun entrypoint:

```bash
bun run skills:sync:agent -- --target cursor --project <repo> --all --mode copy
```

Reload the target tool after syncing. Keep skill bodies concise, avoid
auxiliary docs inside skill folders, and put detailed task-specific guidance in
`references/`. Provider adapters under `agents/` should stay thin and point back
to the canonical `SKILL.md`.
