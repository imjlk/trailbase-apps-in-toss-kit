# 기여하기

## Windows 네이티브 개발

Git Bash를 포함한 Git for Windows, rustup, mise를 설치합니다. Rust MSVC
호스트에는 Visual Studio C++ 빌드 도구와 Windows SDK도 필요합니다.
기존 Visual Studio Installer에서 **MSVC x64/x86 빌드 도구**와
**Windows 10/11 SDK**를 추가하세요. `link.exe`나 `dbghelp.lib`를 찾지
못하면 필수 구성요소가 없거나 설치가 아직 끝나지 않은 상태입니다.

체크아웃의 PowerShell에서 시스템 Node 설치를 바꾸지 않고 지정된 버전을
사용할 수 있습니다.

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

`deps:install`은 frozen lockfile을 유지하며 Windows에서는 Bun의 hoisted
linker를 선택합니다. 키트가 컨슈머의 `vendor/trailbase-apps-in-toss-kit`
경로에 있으면 기본 isolated 워크스페이스 저장소가 `ENAMETOOLONG`을
발생시킬 수 있습니다. Windows에서 Bun을 직접 실행할 때는
`bun install --frozen-lockfile --linker hoisted`를 사용하세요.
Unix에서는 Bun의 기본 linker를 유지합니다.

`cargo:local`, `cargo:test`, `cargo:check` 및 공유 캐시 프로세스 그룹 래퍼는
Unix 또는 WSL 전용입니다. Windows 네이티브에서는 위의 직접 Cargo 명령을
사용하세요. `cargo:cache:report`도 Unix 호환 `du`가 필요합니다. POSIX
시그널 전달과 파일 권한 비트 검증은 Unix에서만 실행하며, Windows 파일
권한은 ACL로 관리합니다. 셸 템플릿 테스트는 WSL 배포판 없이 Git Bash로
실행합니다. `.gitattributes`는 `core.autocrlf` 설정과 관계없이 셸 템플릿의
LF 줄바꿈을 유지합니다.

Docker 이미지 빌드와 TrailBase 서버/WASM 통합 스모크에는 실행 중인 Docker
Desktop Linux 엔진이 추가로 필요합니다. 단위 테스트와 SQL 템플릿 스모크에는
Docker나 실제 Toss 인증정보가 필요하지 않습니다. 네이티브 테스트는 키트의
동작을 검증하며, Toss 앱 안의 실제 SDK 동작을 검증하지는 않습니다.

컨슈머 업그레이드 비교는 CRLF와 LF를 정규화하므로 Windows 체크아웃 자체를
업그레이드 충돌이나 마이그레이션 검토 사유로 판단하지 않습니다.

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
