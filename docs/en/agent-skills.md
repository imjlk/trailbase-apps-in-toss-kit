# Agent Skill Setup

This page is for people who want to install, review, or contribute the reusable
agent skills that live in this repository.

Agent-facing behavior belongs in `AGENTS.md` and `skills/**`. This page is
human-facing: it explains where the files live, how to sync them into local
tools, and what to check before opening a PR.

The repository is the source of truth. Local tool-specific skill directories are
install targets, not canonical sources.

## Layout

```text
skills/
  trailbase-ops/
    SKILL.md
    agents/
      openai.yaml
      claude-code.md
      cursor.mdc
      windsurf.md
      github-copilot.instructions.md
      gemini-command.toml
    references/
```

Each skill must follow the standard provider-neutral shape:

- `SKILL.md` with YAML frontmatter `name` and `description`.
- `agents/openai.yaml` with Codex/OpenAI UI metadata.
- Provider adapters under `agents/` for tools that need their own rule,
  subagent, instruction, or command format.
- Optional `references/`, `scripts/`, or `assets/` only when they directly help
  the skill.
- No `README.md`, `CHANGELOG.md`, or installation guide inside a skill folder.

## Install Or Sync

Use Bun from the kit repo root:

```bash
bun run skills:validate
bun run skills:sync
```

| Tool | Command | Default destination |
| --- | --- | --- |
| Codex/OpenAI | `bun run skills:sync` | `$CODEX_HOME/skills` or `~/.codex/skills` |
| Codex/OpenAI copy | `bun run skills:sync:copy -- --force` | `$CODEX_HOME/skills` or `~/.codex/skills` |
| Cline | `bun run skills:sync:cline` | `$CLINE_HOME/skills` or `~/.cline/skills` |
| Claude Code | `bun run skills:sync:claude` | `~/.claude/agents` |
| Cursor | `bun run skills:sync:agent -- --target cursor --project <repo> --all --mode copy` | `<repo>/.cursor/rules` |
| Windsurf | `bun run skills:sync:agent -- --target windsurf --project <repo> --all --mode copy` | `<repo>/.windsurf/rules` |
| GitHub Copilot | `bun run skills:sync:agent -- --target github-copilot --project <repo> --all --mode copy` | `<repo>/.github/instructions` |
| Gemini CLI | `bun run skills:sync:agent -- --target gemini --project <repo> --all --mode copy` | `<repo>/.gemini/commands` |

Use `link` while developing this repo so local edits are visible immediately in
the target tool. Use `copy` for stable snapshots or project-scoped files that
will be committed in another repo. Project-scoped targets require
`--project <repo-path>` and never update root always-on instruction files.

Pass `--force` directly to the script when replacing an existing install:

```bash
bun scripts/sync-agent-skills.mjs trailbase-ops --target claude-code --mode copy --force
```

After syncing, restart or reload the target tool so it picks up the new files.

## Add Or Change A Skill

1. Create `skills/<skill-name>/SKILL.md`.
2. Keep `SKILL.md` concise and move detailed guidance into `references/`.
3. Add `agents/openai.yaml`; its default prompt must mention `$<skill-name>`.
4. Add provider adapters for Claude Code, Cursor, Windsurf, GitHub Copilot, and
   Gemini CLI. Cline consumes the skill directory itself.
5. Run `bun run skills:validate`.
6. If useful locally, run `bun scripts/sync-agent-skills.mjs <skill-name> --target codex --mode link`.

Keep the common case near the top of `SKILL.md`. Move long examples, reference
tables, and troubleshooting notes into `references/` so the skill can load them
only when needed.
