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
- Last verified TrailBase server: `0.33.14`
- Last verified TrailBase release date: `2026-09-10`
- Upstream latest TrailBase server: `0.33.14`
- Upstream latest TrailBase release date: `2026-09-10`
- Upstream Rust MSRV/MVRV from release notes: `1.93`
- Upstream Rust toolchain from release notes: `1.95`

Kit minimum supported TrailBase server는 자동으로 올리지 않습니다. 도입 앱의 smoke
test가 통과한 뒤에만 사람이 올립니다.

수동 서버 호환성 값은 `data/trailbase-compat-policy.json`에도 기록합니다. 이 파일은
업스트림 최신 릴리스에서 자동 생성하지 않습니다. 업스트림 최신 버전과 이 kit가 지원한다고
선언한 버전은 서로 다른 신호이기 때문입니다.
TrailBase `0.33.14`는 일회용 kit WASM/auth/Record API/SSE fixture를 통과한 마지막
검증 버전입니다. Docker와 `bun run trailbase:wasm:smoke`로 재현할 수 있습니다.
Smoke는 명시적인 proxy stub mode를 쓰며 컨슈머 checkout이나 배포를 변경하지 않습니다.
컨슈머 실기기·production 검증은 앱이 소유하며 kit minimum은 TBD로 유지합니다.

Rust 도구 버전은 `.mise.toml`과 `rust-toolchain.toml`에 함께 노출합니다. 개발자가 repo
toolchain을 설치할 때는 `mise`를 기본 진입점으로 사용하고, `rust-toolchain.toml`은 Cargo,
rustup, editor, CI가 표준 Rust 프로젝트 방식으로 동작하도록 유지합니다.

새 `.mise.toml`을 받은 뒤에는 이 checkout에서 `mise trust`를 한 번 실행하고,
`mise install`로 고정된 tool을 설치하세요.

## Renovate가 추적하는 업스트림 버전

<!-- renovate: datasource=github-releases depName=trailbaseio/trailbase extractVersion=^v(?<version>.*)$ versioning=semver -->
- `trailbase-server-github-release`: `0.33.14`

<!-- renovate: datasource=crate depName=trailbase-wasm versioning=cargo -->
- `trailbase-wasm`: `0.6.1`

<!-- renovate: datasource=crate depName=trailbase-client versioning=cargo -->
- `trailbase-client`: `0.10.1`

<!-- renovate: datasource=npm depName=trailbase versioning=npm -->
- `trailbase-js-client`: `0.14.1`

이 Renovate marker block이나 `renovate.json`을 수정했다면 `bun run renovate:validate`로
설정을 검증하세요. 이 명령은 실행 시점에 `npx`로 Renovate validator를 설치해서 쓰므로
validator를 dependency로 커밋할 필요는 없습니다.

## 검토한 호환성 변경

- `0.29.0`은 username 기반 auth와 anonymous auth를 추가하고 `_user.email`을
  case-insensitive로 바꾸며 email 값 정규화를 중단합니다. Kit은 Apps in Toss identity를 계속
  TrailBase `_user`에 매핑합니다. 도입 앱 auth smoke는 기존 synthetic identity와 session
  bootstrap을 확인해야 합니다.
- `0.30.0`은 custom Rust server 구성 API를 변경합니다. 이 kit은 custom TrailBase server
  binary를 배포하지 않지만, custom binary를 쓰는 도입 앱은 `api::serve()` 또는
  `Server::init*` 연동을 수정해야 합니다.
- `0.31.0`은 batch/transaction Record API 응답을 operation마다 결과 하나를 반환하는 형태로
  바꿉니다. 이 API를 쓰는 도입 앱은 응답 parsing을 수정해야 합니다.
- `0.31.1`은 `--data-dir`/`DATA_DIR`을 deprecated 처리하고 `--depot`/`DEPOT`을 권장합니다.
  Kit runtime은 `--depot`이 없는 `0.28.6` 같은 이전 서버와의 호환성을 위해 아직 허용되는
  legacy `--data-dir` 표기를 유지합니다. `--depot`이 없는 버전보다 minimum supported server를
  높인 뒤 runtime 명령을 전환하세요.
- 최신 Rust client는 `0.10.1`, JS client는 `0.14.1`이며 `trailbase-wasm`은 이제
  `0.6.1`입니다. Kit의 optional JS peer 범위 `>=0.12.1 <1`은 이미 `0.14.1`을 허용합니다.

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
  --image trailbase/trailbase:0.33.14

CI_STRICT=1 node vendor/trailbase-apps-in-toss-kit/scripts/check-trailbase-version-policy.mjs \
  --version 0.33.14
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

## Guest ABI와 인증 migration

TrailBase 0.32는 component interface를 변경했습니다. 이 checkout은
`trailbase-wasm` 0.6.1로 빌드하므로 호환 서버와 함께 배포해야 하며 검증한 조합은
0.33.14입니다. 컨슈머 Rust component를 모두 다시 빌드하고 upstream 안내에 따라
first-party auth-ui component도 갱신하세요. 조합 migration을 준비하기 전에는 기존
kit/server pair를 유지하세요. 최소 버전 정책을 TBD로 유지한다는 것이 새 component가
0.32 이전 서버에서 실행된다는 뜻은 아닙니다.

TrailBase 0.31.2는 `_user.verified`를 별도 `unverified_email` 컬럼으로 바꾸었고
null이 아닌 `email`은 검증된 주소를 나타냅니다. Kit는 transaction 안에서 스키마를
확인합니다. 이전 스키마에는 verified flag를 쓰고, 새 스키마에는 검증된 service email을
직접 저장합니다. 기존 unverified-only service principal은 비밀번호를 초기화하지 않고
승격할 수 있습니다. 이미 검증된 계정의 진행 중인 이메일 변경을 덮거나 여러 미검증
service identity 중 하나를 임의로 선택하지 않습니다. Token 발급은 공식 로그인과
비밀번호 회전 경로를 유지합니다.

검토 범위에는 0.31.3의 중첩 JSON 구독 수정, 0.32의 Rust guest 재사용·auth-ui metadata,
0.33의 refresh token 엔트로피·OAuth cookie 수정, 0.33.14까지의 admin UI·SQL 도구 변경이
포함됩니다. Postgres 호환성은 선언하지 않으며 kit SQL·통합 smoke는 SQLite 기준입니다.
Guest instance가 여러 요청에 재사용될 수 있으므로 사용자·요청 상태를 Rust 전역 cache에
보관하지 마세요.

CI smoke는 명시적인 `compat-smoke` feature로만 fixture를 빌드하고, 전용 Docker network와
loopback host port에서 일회용 컨테이너를 실행합니다. 기능성 원장 template과 auth/ACL/SSE를
검증한 뒤 컨테이너·network·depot을 제거합니다. 실제 서비스에 이 fixture를 설치하지 마세요.
실제 Toss 인증서·구매, auth-ui UX, 컨슈머 전체 migration을 검증하는 테스트는 아닙니다.
