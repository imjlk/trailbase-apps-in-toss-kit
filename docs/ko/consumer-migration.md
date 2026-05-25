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
