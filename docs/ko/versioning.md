# 버전 관리

이 저장소는 changeset 기반 버전과 changelog 관리를 위해 Sampo를 사용합니다.

## 패키지

- `cargo/trailbase-guest-common`
- `cargo/trailbase-toss-identity`
- `npm/@trailbase-apps-in-toss-kit/toss-mtls-client-proxy`

두 Rust WASM helper crate는 `.sampo/config.toml`에서 고정 버전 그룹(fixed group)으로 묶여
함께 이동합니다. Bun mTLS 프록시는 비공개 npm package입니다. Sampo가 버전(version)과
changelog를 관리하지만 npm에는 publish하지 않습니다. GHCR 이미지 릴리스 버전은
`services/toss-mtls-client-proxy/package.json`에서 가져옵니다.

## 일반 변경 흐름

```bash
sampo add
sampo release
git push origin main
```

`sampo release`는 대기 중인 changeset을 소비하고 package version을 올리며 package changelog를
업데이트합니다. 프록시 변경에는 비공개 npm package를 대상으로 지정하세요.

```md
---
npm/@trailbase-apps-in-toss-kit/toss-mtls-client-proxy: patch
---

Describe the proxy change.
```

## 프록시 이미지 릴리스 흐름

`sampo release`가 프록시 패키지 버전(proxy package version)을 올리고 릴리스 커밋(release
commit)이 `main`에 들어가면, GHCR 이미지 워크플로(image workflow)는
`services/toss-mtls-client-proxy/package.json`을 읽습니다.
`toss-mtls-client-proxy-vX.Y.Z`가 아직 없으면 workflow가 해당 git tag를 만들고 같은 run에서
`latest`, `X.Y.Z`, `X.Y`, `X` 이미지 태그를 push합니다.

수동 `toss-mtls-client-proxy-vX.Y.Z` 태그 push도 지원합니다. 워크플로는 릴리스 태그(release
tag)가 프록시 패키지 버전(proxy package version)과 일치하지 않으면 거부합니다.

## 이미지 태그

- `edge`: 가장 최근에 성공한 `main` 또는 정기 빌드(scheduled build).
- `sha-<shortsha>`: 감사와 rollback을 위한 소스 커밋 태그(source commit tag). 정기 재빌드는
  기반 이미지가 바뀌면 이 태그를 다시 push할 수 있습니다.
- `latest`: 의도적으로 만든 최신 프록시 이미지 릴리스(proxy image release).
- `0.1.4`, `0.1`, `0`: SemVer 릴리스 별칭(release alias).

운영 배포에서는 `0.1.4` 같은 정확한 SemVer 태그를 우선 사용하세요. 의도적으로 마이너
범위(minor range)를 따라가려면 `0.1` 같은 태그를 사용할 수 있습니다. 움직이는 이미지 빌드를
따라가고 싶을 때만 `latest` 또는 `edge`를 사용하세요.
