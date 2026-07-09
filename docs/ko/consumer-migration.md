# 도입 앱 마이그레이션 가이드

기존 TrailBase 기반 AppsInToss 프로젝트가 자체 프록시, SQL 조각, 헬퍼 코드를 가지고 있고
그중 반복되는 부분을 공유 kit(shared kit)로 옮기고 싶을 때 이 가이드를 사용하세요.

목표는 앱의 공개 API, 스키마 소유권, 배포 정책을 바꾸지 않으면서 중복된 인프라 코드를
줄이는 것입니다.

## 시작하기 전에

- 도입 앱의 작업 트리가 깨끗한지 확인합니다. 깨끗하지 않다면 이번 작업과 무관한 변경을
  쉽게 분리할 수 있어야 합니다.
- 어떤 파일이 `templates/trailbase`에서 복사된 것인지, 어떤 파일이 앱 고유 파일인지
  확인합니다.
- 운영 또는 운영과 비슷한 데이터가 이미 있는지 판단합니다. 데이터가 있거나 확실하지
  않다면 마이그레이션 중에 기준 마이그레이션(baseline migration)을 다시 쓰지 마세요.
- 앱에 아직 앱 소유 `users` 세션 모델이 남아 있는지 확인합니다. 이 auth 테이블은 제거
  대상으로 보고, 익명 사용자와 Toss-linked identity를 TrailBase `_user`로 옮길 계획을
  세웁니다.

## 마이그레이션 체크리스트

1. `vendor/trailbase-apps-in-toss-kit`를 하위 모듈(submodule)로 추가합니다.
2. `apps/toss-mtls-proxy`를 공통 `toss-mtls-client-proxy` 서비스로 교체합니다.
3. 기존 WASM 호출자가 계속 동작하도록 Toss 어댑터 경로는 유지합니다.
4. 엔드포인트(endpoint) 경로를 덮어쓰던 환경 변수를 제거합니다.
   - `TOSS_PROMOTION_GET_KEY_PATH`
   - `TOSS_PROMOTION_EXECUTE_PATH`
   - `TOSS_PROMOTION_RESULT_PATH`
   - `TOSS_LOGIN_GENERATE_TOKEN_PATH`
   - `TOSS_LOGIN_ME_PATH`
5. 서비스 참조 이름을 `toss-mtls-proxy`에서 `toss-mtls-client-proxy`로 바꿉니다.
6. 프록시 stub 스모크 테스트, TrailBase Toss 스모크 테스트, 운영 배포 검증을 실행합니다.

## 앱 소유 `users` 제거하기

일부 오래된 AppsInToss 도입 앱은 앱 소유 `users` 테이블과 `APP_SESSION_SECRET` 토큰을 씁니다.
이 형태를 장기 호환 레이어로 보존하지 마세요. 앱을 다음 흐름으로 옮깁니다.

1. AppsInToss 익명 hash를 HMAC 처리합니다.
2. 서버에서 합성 `_user.email`과 서비스 관리 credential을 만듭니다.
3. verified `_user`를 upsert합니다.
4. `_user(id)`를 key로 앱 profile 또는 도메인 row를 만들거나 갱신합니다.
5. TrailBase 공식 auth flow로 auth, refresh, CSRF token을 반환합니다.
6. Toss Login은 기존 익명 `_user`에 `toss_identities`를 추가하는 방식으로 연결합니다.

새 auth path를 추가할 때는 마이그레이션 전략에 맞는 hardening table도 같이 추가하세요. 새로
초기화하는 앱은 `profiles.minimal.sql`을 참고하고, reset/additive 양쪽 모두
`anonymous_user_links.sql`과 `anonymous_bootstrap_attempts.sql`를 추가합니다. `auth_state`는
`_user`가 아니라 앱 profile 또는 도메인 row에 둡니다.

`TRAILBASE_AUTH_PASSWORD_SECRET`을 교체해야 한다면 먼저 새 current 값과 함께
`TRAILBASE_AUTH_PASSWORD_SECRET_PREVIOUS`를 배포하세요. helper는 이전 secret으로 파생한
비밀번호로 한 번 로그인한 뒤 current secret 기준으로 `_user.password_hash`를 다시 저장할 수
있습니다.

운영 데이터가 있다면 forward migration을 추가하세요. 앱이 reset을 명시적으로 선택한 경우가
아니라면 baseline SQL을 다시 쓰지 않습니다. 데이터셋이 작다면 직접 forward migration으로
기존 사용자에 대응하는 canonical `_user` row를 만들고, 제품 필드를 `profiles` 또는 도메인
테이블로 복사한 뒤, 도메인 foreign key를 `_user(id)`로 다시 연결하고 같은 migration series에서
기존 app-owned auth 테이블을 drop할 수 있습니다.

앱 데이터가 폐기 가능하거나 의도적으로 초기화할 수 있다면 baseline reset이 더 단순할 수
있습니다. 초기 배포 앱은 데이터 손실을 명시적으로 받아들인 뒤 `_user`, `profiles`, 새
`toss_identities("user")` foreign key 기준으로 baseline을 다시 만들 수 있습니다.

앱 코드에서 TrailBase JWT 서명이나 `_session` write를 복제하지 마세요. 앱별 `_user` 매핑이
끝난 뒤 TrailBase auth endpoint 또는 검증된 runtime-safe 경로로 token을 발급하세요.

## 템플릿 차이 확인

복사된 템플릿은 하위 모듈과 실시간으로 연결되어 있지 않습니다. 이 kit를 업데이트한 뒤에는
`templates/trailbase`와 도입 앱에 복사된 SQL, Compose, 환경 변수, 스모크 테스트 파일을
비교하고, 필요한 변경만 도입 앱에 명시적으로 커밋하세요.

도입 앱을 업데이트할 때 이 저장소의 참고용 차이 확인 스크립트를 사용할 수 있습니다.

```bash
bun scripts/compare-consumer-templates.mjs /path/to/consumer
```

이 명령은 기본적으로 성공 상태로 끝나며 후보 diff를 출력합니다. 누락된 후보나 템플릿 차이를
검증 실패로 처리하고 싶을 때만 `--strict`를 사용하세요.

앱별 복사 위치가 정해져 있다면 명시적인 mapping 파일을 넘겨 불필요한 후보 검색을 줄일 수
있습니다.

```bash
bun scripts/compare-consumer-templates.mjs /path/to/consumer --mapping apps/trailbase/kit-template-map.json
```

CI 로그나 릴리스 체크리스트에는 후보별 상태와 matched, drift, missing 집계만 남기고
싶을 때 `--summary`를 사용하세요. 전체 diff를 확인해야 할 때는 `--summary` 없이 다시
실행하면 됩니다.

```bash
bun scripts/compare-consumer-templates.mjs /path/to/consumer --mapping apps/trailbase/kit-template-map.json --summary
```

Mapping 파일은 다음 형태입니다.

```json
{
  "checks": [
    {
      "name": "Proxy env example",
      "template": "templates/trailbase/env/toss-mtls-client-proxy.env.example",
      "consumer": "apps/trailbase/.env.production.example",
      "mode": "env-subset"
    },
    {
      "name": "Compose toss mTLS proxy",
      "template": "templates/trailbase/compose/toss-mtls-client-proxy.yml",
      "consumer": "apps/trailbase/docker-compose.yml",
      "mode": "compose-service",
      "service": "toss-mtls-client-proxy",
      "volumes": ["mtls_client_certs"]
    }
  ]
}
```

Mapping `mode`의 기본값은 `exact`이며 전체 파일을 비교합니다. 도입 앱의 Compose 파일 안에
앱 고유 서비스와 복사한 proxy 조각이 함께 있다면 `compose-service`를 사용하세요. 앱별 env
예시 파일 안에 kit가 요구하는 proxy key만 포함되어 있는지 보고 싶다면 `env-subset`을 사용합니다.

하위 모듈 checkout만 바꾸고 도입 앱의 gitlink를 stage하지 않은 실수를 잡으려면 submodule
checker를 실행하세요.

```bash
bun scripts/check-consumer-submodule.mjs /path/to/consumer --strict
```

## 완료 기준

- 도입 앱의 gitlink가 의도한 kit 커밋을 가리킵니다.
- 복사된 SQL, Compose, 환경 변수, 스모크 테스트 파일을 무작정 덮어쓰지 않고 검토했습니다.
- 운영 환경 변수 검증이 계속 통과합니다.
- 기존 TrailBase WASM 호출자는 여전히 같은 응답 형태를 받습니다.
