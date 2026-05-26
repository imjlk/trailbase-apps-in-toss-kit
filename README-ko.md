# TrailBase Apps in Toss Kit

AppsInToss 서비스에서 재사용할 수 있는 구성 요소 모음입니다. TrailBase 중심 템플릿과, 다른
서버 스택에서도 사용할 수 있는 독립적인 Toss mTLS 클라이언트 프록시를 함께 제공합니다.

TrailBase는 이 kit가 주로 전제하는 AppsInToss 미니앱 백엔드 실행 환경입니다. 이 구조에서
TrailBase는 각 도입 앱의 SQLite 데이터베이스, Record API, Rust WASM 핸들러, 작업, TrailBase
실행 디렉터리(`traildepot`)를 맡습니다. Kit는 여러 앱에서 반복되는 부분을 모읍니다. WASM
게스트 헬퍼, 안전한 스키마/배포 템플릿, 운영 검증, React Native 클라이언트 연결 코드, 그리고
클라이언트 인증서(client certificate)가 필요한 Toss API를 호출하기 위한 사설 mTLS
프록시(private mTLS proxy)가 여기에 포함됩니다.

도입 앱은 여전히 제품 스키마, 마이그레이션, Record API ACL, 공개 API 형태, 환경 정책, 릴리스
결정(release decision)을 소유합니다. 이 kit는 TrailBase 기반 AppsInToss 서비스를 위한 도구
모음(toolbox)이지, 앱의 TrailBase 프로젝트를 대체하지 않습니다.

이 저장소는 의도적으로 세 종류의 구성물을 함께 관리합니다.

- TrailBase WASM 게스트용 Rust crate.
- 서버 간 Toss API 호출을 위한 Bun 기반 mTLS 클라이언트 프록시.
- SQL, Compose, 환경 변수, 스모크 테스트, runbook용 복사 템플릿.

도입 앱은 이 저장소를 `vendor/trailbase-apps-in-toss-kit` 아래 Git 하위 모듈(submodule)로
추가하는 것을 권장합니다.

## 구조

```text
crates/
  trailbase-guest-common/
  trailbase-toss-identity/
services/
  toss-mtls-client-proxy/
templates/
  trailbase/
docs/
  en/
  ko/
```

문서는 영어와 한글을 함께 관리합니다. 영어 기준 문서는 `docs/en/`에 있고, 같은 파일명의
한글 문서는 `docs/ko/`에 있습니다. `docs/` 밖의 Markdown 번역본은 `README-ko.md`처럼
`-ko.md` 접미사를 사용합니다.

kit의 어떤 부분을 도입할지 결정할 때에는 `docs/en/index.md` 또는 `docs/ko/index.md`부터
읽으세요.

## 참고 문서

- [TrailBase](https://trailbase.io/) 및 TrailBase
  [Record APIs](https://trailbase.io/documentation/apis_record/),
  [migrations](https://trailbase.io/documentation/migrations/),
  [production setup](https://trailbase.io/documentation/production/) 문서.
- [AppsInToss Developer Center](https://developers-apps-in-toss.toss.im/).
- [Coolify Docker Compose docs](https://coolify.io/docs/knowledge-base/docker/compose).
- [Bun docs](https://bun.com/docs).
- [TanStack DB](https://tanstack.com/db/latest/docs) 및
  [TanStack Query](https://tanstack.com/query/latest/docs/framework/react/overview).

## 통합 방식

Rust crate는 하위 모듈에서 경로 의존성(path dependency)으로 사용하세요. SQL과 Compose 템플릿은 수정하기
전에 앱 저장소로 복사해야 합니다. 데이터베이스 마이그레이션은 실제로 실행하는 앱이 소유해야
하기 때문입니다.

mTLS 프록시는 TrailBase 전용이 아닙니다. TrailBase WASM 게스트는 헬퍼 crate를 통해 호출할 수
있지만, 사설 네트워크에서 인증된 HTTP 요청을 보낼 수 있는 백엔드라면 같은 컨테이너를 사용할
수 있습니다. 인증서는 프록시에만 마운트(mount)하고, 애플리케이션 서비스에는 내부 프록시 URL과
Bearer 토큰만 제공하세요. 호출은 일반 mTLS relay 또는 AppsInToss 어댑터 엔드포인트(adapter
endpoint)를 사용합니다.

mTLS 프록시 이미지는 인증서와 토큰을 실행 시점(runtime)에만 받는 한 공개해도 안전합니다.
실행 중인 프록시 인스턴스는 Compose 또는 플랫폼 내부 네트워크 안에서 비공개(private)로
유지해야 합니다.

## 컨테이너 이미지

`toss-mtls-client-proxy` 이미지는 GitHub Actions가 다음 GHCR 경로로 배포합니다.

```text
ghcr.io/imjlk/trailbase-apps-in-toss-kit/toss-mtls-client-proxy
```

이미지에는 Bun 런타임 코드만 포함됩니다. mTLS 인증서, 프록시 토큰(proxy token), 프로모션
코드(promotion code), 앱 비밀값(secret)은 포함하지 않습니다. 인증서는 실행 시점(runtime)에
마운트하고 프록시 인스턴스는 내부 전용으로 유지하세요.

이미지 워크플로(workflow)는 프록시 소스 변경, 릴리스 태그(release tag), 수동 실행, 월 2회
정기 재빌드(scheduled rebuild)에서 실행됩니다. 소스가 바뀌지 않아도 기반 이미지(base image)
보안 패치를 반영하기 위한 흐름입니다.

이미지 태그 정책:

- `edge`: 가장 최근에 성공한 `main` 빌드.
- `sha-<shortsha>`: 감사와 rollback을 위한 소스 커밋 태그(source commit tag). 정기 재빌드는
  기반 이미지가 바뀌면 이 태그를 다시 push할 수 있습니다.
- `latest`, `0.1.0`, `0.1`, `0`: 프록시 package version이 `main`에서 Sampo release로
  올라가거나 대응하는 `toss-mtls-client-proxy-v0.1.0` tag를 수동으로 push할 때 만들어지는
  릴리스 태그.

Renovate는 GitHub Actions, Docker, Cargo, Bun/npm, mise 도구 버전, 문서화된
TrailBase reference version을 추적합니다. TrailBase release notes는 별도의
`TrailBase release watch` workflow로 추적합니다. 업스트림이 Rust MSRV/MVRV와 Rust
toolchain 변경 같은 운영 호환성 메모를 GitHub release와 CHANGELOG에 기록하기 때문입니다.

Kit minimum supported TrailBase server version은 자동으로 올리지 않습니다. 도입 앱 smoke
test가 통과한 뒤에만 올립니다. 추적 정책은 `docs/en/trailbase-tracking.md`와
`docs/ko/trailbase-tracking.md`를 참고하세요.

## 버전 관리

Sampo는 changeset 기반 버전(version)과 changelog 관리를 위해 초기화되어 있습니다. Rust helper
crate는 고정 버전 그룹(fixed version group)으로 묶여 `trailbase-guest-common`과
`trailbase-toss-identity`가 함께 이동합니다. Bun 프록시는 버전 관리(versioning)만을 위해
비공개 npm package로 추적되며 npm에는 publish하지 않습니다.

일반적인 흐름은 다음과 같습니다.

```bash
sampo add
sampo release
git push origin main
```

`sampo release`가 프록시 패키지 버전(proxy package version)을 올리고 릴리스 커밋(release
commit)이 `main`에 들어가면, 이미지 워크플로는 필요한 경우 대응하는
`toss-mtls-client-proxy-vX.Y.Z` git tag를 만들고 GHCR 릴리스 태그를 배포합니다.

자세한 릴리스 및 이미지 태그 정책은 `docs/en/versioning.md`를 참고하세요. 한글 문서는
`docs/ko/versioning.md`에 있습니다.
