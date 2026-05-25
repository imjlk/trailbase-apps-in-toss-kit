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
- 앱이 아직 legacy 앱 소유 `users` 세션 모델을 쓰는지 확인합니다. 새 작업은 익명 사용자와
  Toss-linked 사용자 모두 TrailBase `_user`를 사용해야 합니다.

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

## Legacy `users`에서 `_user`로 이동하기

기존 AppsInToss 도입 앱은 앱 소유 `users` 테이블과 `APP_SESSION_SECRET` 토큰을 쓰는 경우가
많습니다. 이 형태는 호환성 목적으로만 유지하세요. 새 기본 흐름은 다음과 같습니다.

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

운영 데이터가 있다면 forward migration을 추가하세요. baseline SQL을 다시 쓰지 않습니다.
`light-on-off` 형태의 마이그레이션은 기존 도메인 `users` 테이블을 보존하면서 `_user` 매핑
컬럼이나 companion profile 테이블을 추가하고, Record API ACL을 `_USER_.id`로 점진적으로
이동합니다.

앱 데이터가 폐기 가능하거나 의도적으로 초기화할 수 있다면 baseline reset이 더 단순할 수
있습니다. `tatatata-cattower` 같은 초기 배포는 데이터 손실을 명시적으로 받아들인 뒤
`_user`, `profiles`, 새 `toss_identities("user")` foreign key 기준으로 baseline을 다시 만들 수
있습니다.

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

Mapping 파일은 다음 형태입니다.

```json
{
  "checks": [
    {
      "name": "Proxy env example",
      "template": "templates/trailbase/env/toss-mtls-client-proxy.env.example",
      "consumer": "apps/trailbase/.env.production.example"
    }
  ]
}
```

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
