# 기여하기

## 문서

문서는 가능하면 영어와 한글을 함께 관리합니다. `docs/` 아래 문서는 병렬 경로를 사용합니다.
영문 파일은 `docs/en/`에 두고, 같은 파일명의 한글 파일은 `docs/ko/`에 둡니다.

`docs/` 밖의 Markdown 문서는 영문 파일명을 기본으로 유지하고, 한글 문서는
`README-ko.md`, `CONTRIBUTING-ko.md`처럼 `-ko.md` 접미사를 붙입니다.

## 에이전트 스킬

저장소에서 관리하는 에이전트 스킬은 `skills/` 아래에 있습니다. 이 디렉터리를 기준
원본(source of truth)으로 취급하고, 로컬 도구별 스킬 항목은 여기에서 동기화하세요.

스킬을 추가하거나 변경하는 PR을 열기 전에 다음을 실행합니다.

```bash
bun run skills:validate
```

로컬 개발 중에는 스킬을 Codex에 심볼릭 링크(link)할 수 있습니다.

```bash
bun run skills:sync
```

Claude Code와 Cline도 전역 동기화를 지원합니다.

```bash
bun run skills:sync:claude
bun run skills:sync:cline
```

프로젝트별 어댑터는 공통 Bun 진입점(entrypoint)을 사용합니다.

```bash
bun run skills:sync:agent -- --target cursor --project <repo> --all --mode copy
```

동기화한 뒤에는 대상 도구를 다시 불러오세요(reload). `SKILL.md` 본문은 간결하게 유지하고,
스킬 폴더 안의 보조 문서는 최소화하세요. 자세한 작업별 지침은 `references/`에 둡니다. `agents/` 아래
도구별 어댑터(provider adapter)는 얇게 유지하고 기준 `SKILL.md`를 가리키게 하세요.
