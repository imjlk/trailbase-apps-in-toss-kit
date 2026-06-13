# 공개 저장소 배포 메모

이 저장소는 공개 GitHub 저장소로 공개해도 안전하도록 구성하는 것을 목표로 합니다.

## 공개해도 되는 것

- Rust helper crate와 SQL 템플릿.
- Bun 프록시 소스 코드.
- Dockerfile과 GitHub Actions 워크플로(workflow).
- 자리표시자(placeholder)만 들어 있는 예시 환경 변수 파일.
- 공개 AppsInToss API 경로와 공개 base URL.

## 커밋하면 안 되는 것

- mTLS 클라이언트 인증서 또는 비밀키(private key).
- 실제 `MTLS_PROXY_TOKEN` 값.
- 실제 Toss 프로모션 코드.
- 실제 앱 비밀값(secret), HMAC secret, 암호화 key, Coolify `.env.production` 파일.
- 원본 Toss `userKey` 값이 포함된 log.

## GHCR 이미지

워크플로(workflow)는 프록시 이미지를 GitHub Container Registry(GHCR)에 배포합니다.

```text
ghcr.io/imjlk/trailbase-apps-in-toss-kit/toss-mtls-client-proxy
```

워크플로는 소스 변경, 릴리스 태그(release tag), 수동 실행, 월 2회 정기 재빌드(scheduled
rebuild)에서 실행됩니다. 정기 재빌드는 upstream Bun 기반 이미지(base image)에 보안 패치가
들어왔을 때 소스 변경 없이도 `edge`와 `sha-*` 태그를 새로 빌드하기 위한 장치입니다.

## 태그 정책

프록시 이미지 워크플로는 `services/toss-mtls-client-proxy/package.json`을 읽습니다. Sampo
릴리스 PR이 `main`에서 비공개 npm 패키지 버전(package version)을 올리면,
워크플로는 대응하는 `toss-mtls-client-proxy-vX.Y.Z` 태그가 없을 때 이를 만들고 릴리스 이미지
태그(release image tag)를 배포합니다. 수동으로 `toss-mtls-client-proxy-vX.Y.Z` 태그를 push하는 방식도
지원합니다. 워크플로는 태그 버전(tag version)이 프록시 패키지 버전(proxy package version)과
일치하는지 확인합니다.

- `edge`: 가장 최근에 성공한 `main` 또는 정기 빌드(scheduled build).
- `sha-<shortsha>`: 감사와 rollback을 위한 소스 커밋 태그(source commit tag). 정기 재빌드는
  기반 이미지가 바뀌면 이 태그를 다시 push할 수 있습니다.
- `latest`: 의도적으로 만든 최신 릴리스(release). 수동 테스트에는 편하지만 운영에는 권장하지 않습니다.
- `0.1.6`, `0.1`, `0`: SemVer 릴리스 별칭(release alias).

Coolify 운영 환경에서는 `0.1.6` 같은 정확한 태그 또는 `0.1` 같은 마이너 태그(minor tag)를 우선
사용하세요. 움직이는 이미지 빌드를 의도적으로 따라가고 싶을 때만 `latest` 또는 `edge`를 사용합니다.

## 버전 관리

Sampo는 Rust WASM crate와 비공개 JS package의 version/changelog 관리를 맡습니다. 사용자가
체감하는 Rust helper 변경, proxy 변경, 공유 JS package 변경에는 changeset을 추가하고, 기능 PR이
`main`에 들어간 뒤 `Sampo release` workflow가 생성 또는 갱신하는 릴리스 PR을 검토하세요. Rust
helper crate는 고정 버전 그룹(fixed version group)으로 묶여 있습니다. JS package는 비공개이며
npm에 publish하지 않습니다. GHCR 태그는 proxy의 `package.json` version에서 나옵니다.

이미지는 인증서와 토큰을 실행 시점(runtime)에만 받기 때문에 공개해도 안전합니다. 실행 중인
프록시 인스턴스는 애플리케이션 네트워크 안에서 비공개(private)로 유지해야 합니다.
