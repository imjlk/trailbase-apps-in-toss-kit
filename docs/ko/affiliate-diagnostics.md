# 제휴 상품 진단

`affiliate-doctor`는 운영 카탈로그와 같은 카테고리 정책을 검사하고 같은 선택기로
후보를 미리 봅니다. 링크 발급·쇼핑 앱 열기·구매 확인·제공자 설정 변경은 하지 않습니다.

```sh
node packages/trailbase-runtime/bin/affiliate-doctor.mjs --policy path/to/policy.json
node packages/trailbase-runtime/bin/affiliate-doctor.mjs --policy path/to/policy.json --topics cleaning --live
```

기본 동작은 오프라인 구조 검사입니다. `--live`를 명시하면 서버 환경의
`TOSS_SHOPPING_ACCESS_KEY`, `TOSS_SHOPPING_SECRET_KEY`, `TOSS_SHOPPING_PUBLISHER_ID`와
선택형 등록된 `TOSS_SHOPPING_SUB_TAG_ID`로 조회합니다. 등록된 출발지 서버에서 실행하고
이 값을 프론트엔드 환경에 복사하지 마세요.

출력은 JSON입니다. `incomplete`는 설정만 검사했음을, `ready`는 카테고리·상품의
조회 전용 선택이 성공했음을 뜻합니다. 링크 발급, 서비스 승인, 수익 귀속의 증거는
아닙니다. `linkIssuanceTested`는 항상 false이고 미리보기 `url`은 null입니다.
그룹/카테고리 ID와 공개 상품명은 포함하지만 bearer·비밀값·원시 오류·추적 링크는
출력하지 않습니다.

- `invalid-policy`: 보고된 필드 경로를 수정합니다.
- `authentication-or-permission`: 인증 정보와 API 권한을 확인합니다.
- `access-denied`: 서버 출발지 IP 등록과 계정/서비스 접근 권한을 확인합니다.
- `quota-exceeded` / `rate-limited`: 제공자 제한이 해제될 때까지 기다립니다.
- `unmatched-or-excluded-category`: 설정 그룹을 실제 분류 트리와 대조합니다.
- `no-eligible-product`: 선택 정책을 통과한 후보가 없으며 기존 광고를 유지합니다.
- `transport` / `provider-unavailable`: 서버 연결과 제공자 상태를 확인합니다.

라이브러리는 `trailbase-runtime/affiliate/diagnostics`에서
`diagnoseAffiliateCatalog`, `validateAffiliatePolicy`를 제공합니다. 소비자는 개발용
fixture 제공자와 실제 정책을 주입하고 `mode: 'fixture'`로 표시할 수 있습니다.
실제 제공자를 넣더라도 일반 `issueLink` 구현은 호출하지 않습니다.

종료 코드는 ready/warning/오프라인 incomplete는 0, 검사 실패는 1, CLI 인자 오류는
2입니다. 종료 코드 0을 운영 준비 완료로 해석하지 말고 보고서 status를 확인하세요.
