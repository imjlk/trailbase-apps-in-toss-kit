# TrailBase 업스트림 추적

이 저장소는 TrailBase 기반 AppsInToss 서비스를 위한 재사용 가능한 통합 kit입니다.
TrailBase 서버를 vendoring하지 않습니다. TrailBase server, client, runtime, Rust
toolchain 변경은 업스트림 호환성 입력값으로 추적합니다.

## 공식 업스트림 소스

- GitHub repository: https://github.com/trailbaseio/trailbase
- GitHub releases: https://github.com/trailbaseio/trailbase/releases
- CHANGELOG: https://raw.githubusercontent.com/trailbaseio/trailbase/main/CHANGELOG.md
- Website/docs: https://trailbase.io/

## 호환성 정책

아래 값은 이 kit의 정책 값입니다.

- Kit minimum supported TrailBase server: `TBD`
- Last verified TrailBase server: `0.28.5`
- Last verified TrailBase release date: `2026-06-12`
- Upstream latest TrailBase server: `0.28.6`
- Upstream latest TrailBase release date: `2026-06-17`
- Upstream Rust MSRV/MVRV from release notes: `1.93`
- Upstream Rust toolchain from release notes: `1.95`

Kit minimum supported TrailBase server는 자동으로 올리지 않습니다. 도입 앱의 smoke
test가 통과한 뒤에만 사람이 올립니다.

수동 서버 호환성 값은 `data/trailbase-compat-policy.json`에도 기록합니다. 이 파일은
업스트림 최신 릴리스에서 자동 생성하지 않습니다. 업스트림 최신 버전과 이 kit가 지원한다고
선언한 버전은 서로 다른 신호이기 때문입니다.
TrailBase `0.28.6`은 현재 업스트림 최신 버전으로만 추적합니다. Kit와 도입 앱 smoke test가
통과하기 전까지 last verified kit policy는 `0.28.5`로 유지합니다.

Rust 도구 버전은 `.mise.toml`과 `rust-toolchain.toml`에 함께 노출합니다. 개발자가 repo
toolchain을 설치할 때는 `mise`를 기본 진입점으로 사용하고, `rust-toolchain.toml`은 Cargo,
rustup, editor, CI가 표준 Rust 프로젝트 방식으로 동작하도록 유지합니다.

새 `.mise.toml`을 받은 뒤에는 이 checkout에서 `mise trust`를 한 번 실행하고,
`mise install`로 고정된 tool을 설치하세요.

## Renovate가 추적하는 업스트림 버전

<!-- renovate: datasource=github-releases depName=trailbaseio/trailbase extractVersion=^v(?<version>.*)$ versioning=semver -->
- `trailbase-server-github-release`: `0.28.6`

<!-- renovate: datasource=crate depName=trailbase-wasm versioning=cargo -->
- `trailbase-wasm`: `0.5.1`

<!-- renovate: datasource=crate depName=trailbase-client versioning=cargo -->
- `trailbase-client`: `0.8.1`

<!-- renovate: datasource=npm depName=trailbase versioning=npm -->
- `trailbase-js-client`: `0.12.1`

이 Renovate marker block이나 `renovate.json`을 수정했다면 `bun run renovate:validate`로
설정을 검증하세요. 이 명령은 실행 시점에 `npx`로 Renovate validator를 설치해서 쓰므로
validator를 dependency로 커밋할 필요는 없습니다.

## Release Watch 출력물

`TrailBase release watch` workflow는 업스트림 snapshot을 아래 경로에 씁니다.

- `data/upstream/trailbase/latest-release.md`
- `data/upstream/trailbase/version-policy.json`

Snapshot script는 먼저 최신 GitHub release를 읽습니다. Release notes에 Rust 정책이 없으면
TrailBase CHANGELOG에서 Rust MSRV/MVRV 또는 toolchain 변경을 언급한 가장 최신 섹션을
찾습니다.

정기 release-watch workflow를 사용하기 전에 `TRAILBASE_RELEASE_WATCH_TOKEN`이라는 repo secret을
설정하세요. 이 secret은 해당 저장소에 branch push와 pull request 생성 권한이 있는
fine-grained PAT 또는 GitHub App token이어야 합니다. Workflow는 이 non-default token을 사용해
생성된 PR이 downstream `pull_request` check를 자동으로 트리거하도록 합니다. Secret이 없으면 CI
없는 PR을 만들지 않도록 workflow가 빠르게 실패합니다.

## 도입 앱 서버 버전 참고 진단

도입 앱은 복사해 간 Docker Compose 파일과 TrailBase 서버 이미지 태그를 직접 소유합니다. 그래서
이 kit는 도입 앱이 업스트림 최신보다 낮은 TrailBase 서버를 사용한다는 이유만으로 CI를 실패시키지
않습니다. 앱이 고정하고 검증한 버전이라면 낮은 버전도 유효할 수 있습니다.

도입 앱의 CI나 배포 runbook에서 앱의 TrailBase 서버 태그와 kit의 수동 정책 사이의 관계를 보고
싶다면 참고 진단 스크립트를 사용하세요.

```bash
node vendor/trailbase-apps-in-toss-kit/scripts/check-trailbase-version-policy.mjs \
  --compose docker-compose.yml

node vendor/trailbase-apps-in-toss-kit/scripts/check-trailbase-version-policy.mjs \
  --image trailbaseio/trailbase:0.28.5

CI_STRICT=1 node vendor/trailbase-apps-in-toss-kit/scripts/check-trailbase-version-policy.mjs \
  --version 0.28.5
```

일반 모드에서는 경고를 출력하되 성공으로 종료합니다. Strict 모드에서는 선언된 kit minimum보다
낮거나, last verified보다 높거나, 서버 이미지 태그가 moving/unparseable인 것처럼 구체적인 정책
위반을 확인할 수 있을 때만 실패합니다. Kit minimum이 아직 `TBD`이면 minimum-version gate는
건너뛰지만, last verified 상한 검사는 계속 적용합니다.

## TrailBase 변경 리뷰 체크리스트

- Release notes에서 breaking API behavior를 확인합니다.
- Record API, auth, realtime subscription, WASM runtime, auth-ui 변경 사항을 확인합니다.
- TrailBase가 Rust MSRV/MVRV 또는 toolchain을 올렸는지 확인합니다.
- 정책 toolchain으로 Rust WASM guest check를 실행합니다.
- 실제 또는 stub TrailBase instance로 도입 앱 smoke test를 실행합니다.
- 호환성이 검증된 뒤에만 template을 갱신합니다.
