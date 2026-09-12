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
cp vendor/trailbase-apps-in-toss-kit/templates/trailbase/release/kit-template-map.example.json \
  apps/trailbase/kit-template-map.json
bun scripts/compare-consumer-templates.mjs /path/to/consumer --mapping apps/trailbase/kit-template-map.json
```

예시 mapping은 기본 Toss identity SQL, proxy Compose 서비스, proxy env 예시, proxy smoke
script를 다룹니다. Strict하게 만들기 전에 경로를 조정하고 적용하지 않는 check는 제거하세요.

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

## 세 버전 업그레이드 계획

소비 앱의 gitlink를 바꾸기 전에 이전 kit 커밋을 기록하세요. `KIT_PREVIOUS_COMMIT`을
해당 커밋으로 설정하고 새 kit 체크아웃에서 실행합니다.

```bash
bun scripts/plan-consumer-upgrade.mjs /path/to/consumer \
  --from "$KIT_PREVIOUS_COMMIT" --to HEAD \
  --mapping apps/trailbase/kit-template-map.json
```

명시적 매핑은 위에서 설명한 `exact`, `compose-service`, `env-subset` 모드를 사용합니다.
이전·새 템플릿은 커밋된 Git 객체에서 읽고, 세 번째 입력은 앱이 직접 수정한 내용을 포함한
소비 앱의 현재 파일입니다. `--from`은 `--to`의 조상이어야 합니다. Shallow checkout이면
필요한 이력을 먼저 가져오세요. 도구는 파일 스테이징, gitlink 갱신, 소비 앱 파일 쓰기,
마이그레이션 실행, 제안한 검증 명령 실행을 수행하지 않습니다.

| 상태 | 의미 |
| --- | --- |
| `unchanged` | 관련 변경 없음 |
| `consumer-only` | 반영할 kit 변경 없이 앱에서만 수정 |
| `already-applied` | 관련 kit 변경이 이미 반영됨 |
| `update-required` | 소비 앱에서 kit 변경 반영 검토 필요 |
| `mergeable-update` | 양쪽이 수정됐지만 Git의 텍스트 3-way 병합에는 충돌 없음 |
| `conflict` | 양쪽 수정이 충돌하거나 추가·삭제에 대한 판단 필요 |
| `kit-removed` | kit에서 삭제됨. 앱 파일을 자동 삭제하지 말 것 |
| `missing-consumer` | 템플릿은 그대로지만 매핑된 소비 앱 파일이 없음 |

보고서는 kit과 소비 앱의 변경 줄 범위를 구분합니다. Compose 줄 번호는 원본 파일이 아닌
선택한 서비스·볼륨 범위를 기준으로 합니다. 텍스트 비교이며 YAML·SQL의 의미 검증은
아닙니다. Anchor, 상속과 앱의 실제 동작은 따로 검토해야 합니다. 환경변수는 키 이름과
변경 분류만 보여주고 값은 출력하지 않습니다. Env 모드는 활성 할당을 비교하며 같은 키는
마지막 할당을 사용합니다. 주석과 앱 전용 키는 비교 범위 밖입니다. 텍스트·JSON 출력 모두
파일 본문이나 내용 해시를 포함하지 않습니다. 임시 비교 파일에도 소비 앱 본문이나 비밀값
대신 불투명한 줄 ID만 저장합니다.

이미 반영한 경우를 제외한 SQL 변경은 소비 앱의 새 순방향 마이그레이션 검토 항목으로
표시합니다. `mergeable-update`여도 과거 마이그레이션을 덮어써도 된다는 의미는 아닙니다.
매핑에 없는 신규·삭제 템플릿도 사용 여부 검토 목록에 표시하며, 선택적 템플릿을 자동으로
필수화하지 않습니다.

`--json`은 버전이 있는 구조화 보고서를 출력합니다. `--strict`는 조정·마이그레이션·미매핑
템플릿 검토가 남으면 종료 코드 1을 반환합니다. 기본 advisory 모드는 비교 성공 시 0,
잘못된 ref·지원하지 않는 입력·잘못된 매핑은 2를 반환합니다. 매핑 경로는 각 루트 안에
있어야 하며 입력은 1 MiB 이하 UTF-8 텍스트 파일이어야 합니다. 보고서와 함께
[Release Doctor](release-doctor.md), 두 커밋 사이 changeset/changelog, 소비 앱의
마이그레이션·인증/ACL·기능 smoke 검증을 확인하세요.

## 완료 기준

- 도입 앱의 gitlink가 의도한 kit 커밋을 가리킵니다.
- 복사된 SQL, Compose, 환경 변수, 스모크 테스트 파일을 무작정 덮어쓰지 않고 검토했습니다.
- 운영 환경 변수 검증이 계속 통과합니다.
- 기존 TrailBase WASM 호출자는 여전히 같은 응답 형태를 받습니다.
