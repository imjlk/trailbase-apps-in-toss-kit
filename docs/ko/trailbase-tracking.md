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
- Last verified TrailBase server: `TBD`
- Last verified TrailBase release date: `TBD`
- Upstream latest TrailBase server: `0.27.9`
- Upstream latest TrailBase release date: `2026-05-25`
- Upstream Rust MSRV/MVRV from release notes: `1.93`
- Upstream Rust toolchain from release notes: `1.95`

Kit minimum supported TrailBase server는 자동으로 올리지 않습니다. 도입 앱의 smoke
test가 통과한 뒤에만 사람이 올립니다.

Rust 도구 버전은 `.mise.toml`과 `rust-toolchain.toml`에 함께 노출합니다. 개발자가 repo
toolchain을 설치할 때는 `mise`를 기본 진입점으로 사용하고, `rust-toolchain.toml`은 Cargo,
rustup, editor, CI가 표준 Rust 프로젝트 방식으로 동작하도록 유지합니다.

새 `.mise.toml`을 받은 뒤에는 이 checkout에서 `mise trust`를 한 번 실행하고,
`mise install`로 고정된 tool을 설치하세요.

## Renovate가 추적하는 업스트림 버전

<!-- renovate: datasource=github-releases depName=trailbaseio/trailbase extractVersion=^v(?<version>.*)$ versioning=semver -->
- `trailbase-server-github-release`: `0.27.9`

<!-- renovate: datasource=crate depName=trailbase-wasm versioning=cargo -->
- `trailbase-wasm`: `0.5.1`

<!-- renovate: datasource=crate depName=trailbase-client versioning=cargo -->
- `trailbase-client`: `0.8.1`

<!-- renovate: datasource=npm depName=trailbase versioning=npm -->
- `trailbase-js-client`: `0.12.1`

## Release Watch 출력물

`TrailBase release watch` workflow는 업스트림 snapshot을 아래 경로에 씁니다.

- `data/upstream/trailbase/latest-release.md`
- `data/upstream/trailbase/version-policy.json`

Snapshot script는 먼저 최신 GitHub release를 읽습니다. Release notes에 Rust 정책이 없으면
TrailBase CHANGELOG에서 Rust MSRV/MVRV 또는 toolchain 변경을 언급한 가장 최신 섹션을
찾습니다.

## TrailBase 변경 리뷰 체크리스트

- Release notes에서 breaking API behavior를 확인합니다.
- Record API, auth, realtime subscription, WASM runtime, auth-ui 변경 사항을 확인합니다.
- TrailBase가 Rust MSRV/MVRV 또는 toolchain을 올렸는지 확인합니다.
- 정책 toolchain으로 Rust WASM guest check를 실행합니다.
- 실제 또는 stub TrailBase instance로 도입 앱 smoke test를 실행합니다.
- 호환성이 검증된 뒤에만 template을 갱신합니다.
