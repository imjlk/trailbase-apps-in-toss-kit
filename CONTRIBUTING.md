# Contributing

## Native Windows development

Install Git for Windows (including Git Bash), rustup, and mise. Rust's MSVC
host also requires the Visual Studio C++ build tools and a Windows SDK. In an
existing Visual Studio installation, add **MSVC x64/x86 build tools** and a
**Windows 10/11 SDK** through Visual Studio Installer. A missing `link.exe` or
`dbghelp.lib` means these prerequisites are missing or installation is incomplete.

From PowerShell in the checkout, use the pinned tools without replacing a
machine-wide Node installation:

```powershell
mise trust
mise install
mise exec -- bun run deps:install
mise exec -- bun run packages:test
mise exec -- bun test services/toss-mtls-client-proxy
mise exec -- bun run packages:typecheck
mise exec -- bun run packages:typecheck:minimum
mise exec -- bun run skills:validate
mise exec -- cargo fmt --all --check
mise exec -- cargo clippy --locked --workspace --all-targets -- -D warnings
mise exec -- cargo test --locked --workspace
mise exec -- cargo check --locked --workspace --target wasm32-wasip2
mise exec -- bun run trailbase:functional-ledgers:smoke
mise exec -- bun run trailbase:owned-currency:smoke
```

`deps:install` preserves the frozen lockfile and selects Bun's hoisted linker on
Windows. The default isolated workspace store can produce `ENAMETOOLONG` when
the kit lives in a consumer's `vendor/trailbase-apps-in-toss-kit` directory.
For a direct Bun install, use `bun install --frozen-lockfile --linker hoisted`
on Windows. Unix installs retain Bun's default linker.

`cargo:local`, `cargo:test`, `cargo:check`, and the shared cache process-group
runner require Unix or WSL. Use the direct Cargo commands above on native
Windows. `cargo:cache:report` also needs a Unix-compatible `du`. POSIX signal
delivery and file-mode tests remain Unix-only; Windows filesystem permissions
are controlled by ACLs. Git Bash runs the shell-template tests without requiring
a WSL distribution. `.gitattributes` keeps shell templates at LF, including
when `core.autocrlf` is enabled.

Docker image builds and TrailBase server/WASM integration smoke tests additionally
require a running Docker Desktop Linux engine. Unit tests and SQL-template smoke
tests do not require Docker or real Toss credentials. Native tests verify kit
behavior, not the SDK inside the Toss app.

Consumer upgrade comparisons normalize CRLF and LF before comparing text, so a
Windows checkout alone does not create an upgrade conflict or migration review.

## Documentation

Documentation should be maintained in English and Korean when practical. Docs
under `docs/` use parallel paths: English files in `docs/en/` and Korean files
with the same filenames in `docs/ko/`.

For Markdown documentation outside `docs/`, keep the English filename as the
default and add Korean translations with a `-ko.md` suffix, for example
`README-ko.md` or `CONTRIBUTING-ko.md`.

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
