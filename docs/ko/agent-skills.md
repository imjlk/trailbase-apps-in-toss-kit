# 에이전트 스킬 설치와 기여

이 문서는 이 저장소에 들어 있는 재사용 가능한 에이전트 스킬을 설치하거나, 리뷰하거나,
새로 기여하려는 사람을 위한 문서입니다.

에이전트가 실제로 따라야 하는 작업 규칙은 `AGENTS.md`와 `skills/**`에 둡니다. 이 문서는
사람이 보는 안내서입니다. 파일이 어디에 있고, 각 도구에 어떻게 연결하며, PR 전에 무엇을
검증해야 하는지를 설명합니다.

기준 원본(source of truth)은 이 저장소입니다. 로컬에 설치되는 도구별 스킬 디렉터리는 설치
결과물일 뿐, 수정 기준이 아닙니다.

## 구조

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

각 스킬은 도구에 종속되지 않는 도구 중립(provider-neutral) 구조를 따라야 합니다.

- `SKILL.md`에는 YAML frontmatter의 `name`, `description`을 둡니다.
- `agents/openai.yaml`에는 Codex/OpenAI UI용 메타데이터를 둡니다.
- 도구별 규칙, 서브에이전트, 지시문, 명령 형식이 필요하면 `agents/` 아래에 얇은 어댑터를 둡니다.
- `references/`, `scripts/`, `assets/`는 스킬에 실제로 도움이 될 때만 추가합니다.
- 스킬 폴더 안에는 `README.md`, `CHANGELOG.md`, 설치 안내 문서를 따로 두지 않습니다.

## 설치 또는 동기화

kit 저장소 루트에서 Bun으로 실행합니다.

```bash
bun run skills:validate
bun run skills:sync
```

| 도구 | 명령 | 기본 설치 위치 |
| --- | --- | --- |
| Codex/OpenAI | `bun run skills:sync` | `$CODEX_HOME/skills` 또는 `~/.codex/skills` |
| Codex/OpenAI 복사 설치 | `bun run skills:sync:copy -- --force` | `$CODEX_HOME/skills` 또는 `~/.codex/skills` |
| Cline | `bun run skills:sync:cline` | `$CLINE_HOME/skills` 또는 `~/.cline/skills` |
| Claude Code | `bun run skills:sync:claude` | `~/.claude/agents` |
| Cursor | `bun run skills:sync:agent -- --target cursor --project <repo> --all --mode copy` | `<repo>/.cursor/rules` |
| Windsurf | `bun run skills:sync:agent -- --target windsurf --project <repo> --all --mode copy` | `<repo>/.windsurf/rules` |
| GitHub Copilot | `bun run skills:sync:agent -- --target github-copilot --project <repo> --all --mode copy` | `<repo>/.github/instructions` |
| Gemini CLI | `bun run skills:sync:agent -- --target gemini --project <repo> --all --mode copy` | `<repo>/.gemini/commands` |

이 저장소에서 스킬을 개발하는 동안에는 `link` 모드를 쓰는 편이 좋습니다. 수정 내용이 대상
도구에 바로 반영됩니다. 다른 저장소에 커밋할 안정된 복사본이나 프로젝트별 규칙 파일이
필요할 때는 `copy` 모드를 사용하세요. 프로젝트별 대상은 `--project <repo-path>`가 필요하며,
루트의 상시 로드 지시문 파일은 건드리지 않습니다.

전역 Codex/OpenAI 설치는 컨슈머 앱의 `vendor/trailbase-apps-in-toss-kit` 서브모듈이 아니라
기준 kit 체크아웃에서 `bun run skills:sync`를 실행하세요. 서브모듈에서 동기화하면 kit
저장소가 앞으로 이동한 뒤에도 Codex가 오래된 컨슈머 서브모듈을 계속 따라갈 수 있습니다.
낡은 Codex 링크를 고치려면 기준 kit 체크아웃에서 아래 명령을 실행한 뒤 Codex를
재시작하세요.

```bash
bun run skills:sync -- --force
```

기존 설치본을 덮어쓸 때는 `--force`를 스크립트에 직접 전달합니다.

```bash
bun scripts/sync-agent-skills.mjs trailbase-ops --target claude-code --mode copy --force
```

동기화한 뒤에는 대상 도구를 재시작하거나 새로고침해서 새 파일을 읽게 하세요.

## 스킬 추가 또는 변경

1. `skills/<skill-name>/SKILL.md`를 만듭니다.
2. `SKILL.md`는 짧게 유지하고, 자세한 설명은 `references/`로 옮깁니다.
3. `agents/openai.yaml`을 추가합니다. 기본 프롬프트에는 `$<skill-name>`을 언급해야 합니다.
4. Claude Code, Cursor, Windsurf, GitHub Copilot, Gemini CLI용 어댑터를 추가합니다.
   Cline은 스킬 디렉터리 자체를 읽습니다.
5. `bun run skills:validate`를 실행합니다.
6. 로컬에서 바로 써 보고 싶다면
   `bun scripts/sync-agent-skills.mjs <skill-name> --target codex --mode link`를 실행합니다.

`SKILL.md` 앞부분에는 가장 자주 쓰는 절차를 먼저 배치하세요. 긴 예시, 참고 표, 문제 해결
메모는 `references/`에 넣어 필요할 때만 읽히게 합니다.
