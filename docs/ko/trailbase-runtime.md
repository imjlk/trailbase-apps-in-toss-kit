# TrailBase 런타임 헬퍼

이 kit는 TrailBase 기반 AppsInToss 서비스를 위한 재사용 가능한 런타임 헬퍼를 제공합니다.
헬퍼는 의도적으로 작게 유지하며 Git 하위 모듈(submodule)을 통해 소스 그대로 가져다 씁니다.
도입 앱은 여전히 자신의 Dockerfile, Compose 파일, `entrypoint.sh`, TrailBase 실행
디렉터리(`traildepot`), 앱별 설정, 배포 정책을 소유합니다.

여러 앱에서 같은 컨테이너 시작 로직이 반복될 때 이 헬퍼를 사용하세요. 앱별 배포 결정을
숨기기 위한 용도로 사용하지는 마세요.

## 런타임 경계

공통 런타임 패키지는 반복되는 컨테이너 시작 작업을 위한 것입니다.

- 공개 TrailBase URL 확인 및 정규화
- 운영 자리표시자(placeholder)와 개발용 secret 차단
- fresh-start 요청을 토큰(token)당 한 번만 적용
- `config.textproto`의 `site_url` 동기화
- 마이그레이션과 컴포넌트를 TrailBase 실행 디렉터리(`traildepot`)로 복사
- JSON settings 파일 작성
- 개발용 스택에서 사용 가능한 로컬 호스트 포트(host port) 찾기
- 예측 가능한 인자 형태로 `trail run` 실행

도입 앱은 다음 앱별 동작을 계속 소유합니다.

- 앱별 환경 변수 이름과 기본값
- 데이터베이스 스키마와 마이그레이션
- 앱별 `settings.json` key
- 추가 운영 환경 변수 규칙
- Compose service 이름, profile, resource sizing
- RN 및 WebView 앱의 로컬 개발 기본값

## 도입 순서

1. 도입 앱의 entrypoint는 도입 앱 저장소에 유지합니다.
2. 런타임 헬퍼 디렉터리를 최종 이미지(final image)로 복사합니다.
3. 도입 앱 entrypoint에서 `entrypoint/lib.sh`를 불러옵니다(source).
4. 공개 URL 정규화나 `config.textproto` 동기화처럼 반복되는 시작 작업을 하나씩 교체합니다.
5. 배포 전에 도입 앱의 운영 환경 변수 검증과 WASM 검증을 실행합니다.

## TrailBase Depot 레이아웃

도입 앱은 보통 두 종류의 depot 경로를 함께 둡니다.

- `apps/trailbase/traildepot-template`: Git으로 추적하는 원본입니다. `config.textproto`,
  `migrations/main`, seed SQL처럼 리뷰되어야 하는 파일만 둡니다.
- `apps/trailbase/traildepot`: TrailBase CLI의 기본 `--data-dir` 이름입니다. DB, secret,
  upload, generated WASM, metadata 같은 런타임 출력은 ignore합니다.

호스트에서 `cd apps/trailbase && trail ...` 형태로 기본 CLI 명령을 쓰고 싶다면
`traildepot/config.textproto`와 `traildepot/migrations`를 template으로 향하는 symlink로
추적하는 패턴을 권장합니다.

```text
apps/trailbase/
  traildepot-template/
    config.textproto
    migrations/main/
  traildepot/
    .gitignore
    config.textproto -> ../traildepot-template/config.textproto
    migrations -> ../traildepot-template/migrations
```

repo root `.gitignore`는 런타임 출력 전체를 무시하되 symlink 두 개만 허용합니다.

```gitignore
apps/trailbase/traildepot/*
!apps/trailbase/traildepot/.gitignore
!apps/trailbase/traildepot/config.textproto
!apps/trailbase/traildepot/migrations
```

이 구조에서는 `trail migration <suffix> main`이 `traildepot/migrations` symlink를 따라
`traildepot-template/migrations/main`에 새 migration을 만듭니다. 컨테이너 entrypoint는
여전히 image에 포함된 template을 `/app/traildepot` 런타임 볼륨으로 복사하므로 배포
경로와 호스트 CLI 경로가 같은 원본 파일을 바라봅니다. Docker named volume의 DB를 직접
수정해야 하는 운영 작업은 별도 스크립트나 컨테이너 내부 `trail --data-dir /app/traildepot`
명령으로 다루세요.

## Entrypoint 패턴

도입 앱 이미지는 런타임 entrypoint 라이브러리를 최종 이미지(final image)로 복사해야 합니다.

```dockerfile
COPY vendor/trailbase-apps-in-toss-kit/packages/trailbase-runtime/entrypoint /app/trailbase-kit/entrypoint
```

그런 다음 앱 entrypoint는 헬퍼를 불러오고(source) 앱별 설정만 유지할 수 있습니다.

```sh
. /app/trailbase-kit/entrypoint/lib.sh

APP_PUBLIC_URL="$(
  trailbase_runtime_resolve_public_url \
    "APP_BASE_URL" \
    "http://127.0.0.1:4000"
)"

trailbase_runtime_sync_config_site_url \
  "/app/traildepot/config.textproto" \
  "$APP_PUBLIC_URL"
```

## Fresh Start

`TRAILBASE_FRESH_START_TOKEN`은 도입 앱이 정한 명시적인 확인 변수(confirmation variable)와
함께 있을 때만 파괴적인 동작을 할 수 있어야 합니다. 헬퍼는 마지막으로 적용한 토큰 표시
파일(token marker)을 기록하므로 같은 값을 다시 사용해도 데이터를 다시 초기화하지 않습니다.

Fresh start는 로컬 개발, 버려도 되는 환경, 또는 명시적인 reset 작업에만 사용하세요. 일반적인
운영 배포(production deploy) 절차로 사용하지 마세요.

## 로컬 포트 선택

로컬에서는 기본 TrailBase 포트와 mTLS 프록시 포트가 자주 충돌합니다. 런타임 헬퍼는 원하는
값부터 1씩 증가시키며 사용 가능한 포트를 찾고, 실제 선택된 포트가 바뀌면 stderr에 경고를
출력할 수 있습니다.

기본값은 다음과 같습니다.

- TrailBase: `4000`
- mTLS 프록시: `8787`

도입 앱은 로컬 개발 명령 출력에 선택된 포트를 보여 주어야 합니다. 그래야 RN 앱, WebView 앱,
스모크 테스트가 올바른 URL을 사용할 수 있습니다.

## 배포 메모

TrailBase는 SQLite 기반이므로 단일 writer 서비스로 다루는 것이 안전합니다. 운영 TrailBase
컨테이너는 recreate 방식의 업데이트를 우선 사용하세요. 앱이 별도로 검증한 HA 전략을 가지고
있지 않다면 운영 TrailBase 서비스에 rolling update를 사용하지 마세요.

mTLS 프록시는 별도의 내부 서비스로 유지합니다. 인증서는 프록시 컨테이너에만 마운트(mount)하고,
TrailBase나 클라이언트 앱 컨테이너에는 마운트하지 않습니다.
