# 프로모션 캠페인

프로모션 캠페인 상태는 특정 기능에 묶이지 않는 공통 구조로 다룹니다. 도입 앱은 이 구조를
미션, 공유, 추천, 시즌 이벤트, 게임 리워드, 온보딩 리워드처럼 운영자가 Toss 프로모션 코드와
리워드 금액을 관리해야 하는 기능에 사용할 수 있습니다.

제품팀이나 운영팀이 앱 코드 변경이나 프록시 재배포 없이 프로모션을 켜고 끌 수 있어야 한다면
이 패턴을 사용하세요. 단일 고정 프로모션만 필요하다면 환경 변수 대체값(fallback)만으로도
충분할 수 있습니다.

## 모델

TrailBase가 프록시 환경 변수뿐 아니라 프로모션 설정까지 관리해야 한다면
`templates/trailbase/sql/promotion_campaigns.sql`을 사용하세요. 앱이 표준 provider 지급
원장도 원한다면 `templates/trailbase/sql/promotion_reward_ledger.sql`을 함께 복사합니다.
캠페인 테이블은 다음 값을 저장합니다.

- `feature_key`: 앱이 정하는 프로모션 기능의 안정적인 키(key).
- `provider`: 현재는 `TOSS`.
- `provider_promotion_code`: Toss Console 프로모션 코드.
- `reward_amount`: 해당 캠페인에서 Toss로 보낼 금액.
- `status`: `DRAFT`, `ACTIVE`, `PAUSED`, `ENDED`, `EXHAUSTED` 같은 운영 상태.
- `starts_at` / `ends_at`: 활성 기간. epoch milliseconds 값입니다. DB 기반 캠페인을
  `ACTIVE`로 전환하기 전에는 필수입니다.
- `budget_limit_amount` / `max_grant_count`: Toss 호출 전에 확인하는 로컬 안전 한도.
  DB 기반 `ACTIVE` 캠페인에는 `budget_limit_amount`가 필수이고, `max_grant_count`는
  선택 사항입니다.

환경 변수 대체값(fallback)은 활성 기간이나 로컬 예산 없이도 동작할 수 있습니다. DB 기반
캠페인은 실제 Toss 호출 전에 운영자가 캠페인 기간과 총 로컬 예산을 명시하도록 더 엄격하게
다룹니다.

기능 키(feature key)는 도입 앱이 소유합니다. 운영자가 이해할 수 있고 오래 유지될 이름이면
충분하며, 모든 비즈니스 규칙을 키에 담을 필요는 없습니다. 예를 들어 한 앱은 미션 리워드용
키와 공유 이벤트용 키를 따로 둘 수 있고, 둘 다 같은 캠페인 테이블 구조를 사용합니다.

모든 자격 조건을 키에 넣기보다 `share_reward`, `onboarding_bonus`처럼 짧고 안정적인 이름을
선택하는 편이 유지보수에 좋습니다.

## 환경 변수 대체값

환경 변수 대체값(fallback)은 기존 배포나 로컬 전용 흐름을 위한 장치입니다.

```text
TOSS_PROMOTION_CODE=...
TOSS_PROMOTION_AMOUNT=50
```

어떤 기능에 DB 캠페인 레코드(row)가 하나라도 있다면, 그 기능에서는 DB 캠페인 상태를 기준
원본(source of truth)으로 보고 환경 변수 대체값을 무시하세요. 캠페인 레코드가 없는 기능은
대체값으로 기존 배포와 스모크 테스트를 계속 동작시킬 수 있습니다.

## 앱별 지급 원장

캠페인 설정은 자격 판정 및 provider 지급 상태와 분리합니다. 새 앱은
`templates/trailbase/sql/promotion_reward_ledger.sql`을 지급 원장의 출발점으로 복사할 수
있습니다. 이미 앱 고유 원장이 있는 서비스는 테이블을 교체하지 말고 forward migration으로
호환 컬럼을 추가하세요. 보통 다음 값을 저장합니다.

- `promotion_campaigns`를 가리키는 NULL 허용(nullable) `campaign_id`.
- 사용자, 주기, 미션, 이벤트 같은 앱별 자격 조건.
- 자격이 생긴 시점에 복사한 `reward_amount`.
- `recorded`, `pending`, `success`, `failed`, `cancelled` 같은 로컬 상태. 자체 원장을 쓰는 앱은
  앱별 상태 이름을 유지할 수 있습니다.
- 고유한 `provider_request_id`.
- `provider_transaction_key`, `provider_status`, `provider_error_code`, `granted_at`,
  `failed_at`, `failure_reason`.

앱이 안전한 공개 뷰(projection)를 명시적으로 만들지 않는 한 이 원장은 앱 내부 또는 관리자
흐름에만 노출하세요. Toss 프로모션 코드, 원본 Toss user key, 제공자 요청 ID(provider request
id), 거래 키(transaction key), 내부 오류 상세를 공개 Record API view에 노출하면 안 됩니다.

TrailBase WASM 핸들러는 `trailbase_guest_common::promotion_rewards`로 멱등 ledger row를
insert하고, 정규화된 provider outcome을 반영하고, 안전한 table/column identifier로 캠페인
사용량을 집계할 수 있습니다. 자격 판정, source dimension, 공유 캠페인 테이블을 넘어서는 예산
정책, 로컬 보상 잔액 반영은 계속 앱이 소유합니다.

## React Native Claim Client

React Native 앱은 `@trailbase-apps-in-toss-kit/ait-rn/promotion`으로 앱이 소유한 campaign
claim endpoint를 generic `campaignId` 기준으로 호출할 수 있습니다.

```ts
await promotions.claim({
  campaignId: "daily-attendance",
  eligibilityId: "attendance-2026-06-19",
  requestId: "daily-attendance:user-123:2026-06-19",
});
```

이 client는 공통 claim status만 정규화하고 Toss promotion code, 캠페인 예산, 원본 Toss user
key, proxy token은 알지 않습니다. `campaignId`를 RN과 백엔드 사이의 계약으로 보고, 백엔드는
이 값을 campaign 설정과 ledger 상태로 해석한 뒤 proxy를 호출하세요.

## 지급 요청 멱등성

프로모션 지급 요청(claim)은 앱 지급 원장 계층에서 멱등(idempotent)해야 합니다. 즉 같은
사용자가 재시도하거나 여러 기기에서 동시에 눌러도 Toss 프로모션이 두 번 실행되지 않아야 합니다.

1. 인증된 사용자의 지급 가능 원장 레코드(row)를 읽습니다.
2. 선택된 캠페인이 활성 상태이고 로컬 예산/횟수 한도에 여유가 있는지 확인합니다.
3. 조건부 update로 원장 레코드를 `ELIGIBLE` 또는 재시도 가능한 `FAILED`에서 `REQUESTED`로
   옮깁니다.
4. 프록시를 호출하기 전에 고유한 제공자 요청 ID(provider request id)를 저장합니다.
5. 해당 요청 ID(request id)로 mTLS 프록시를 한 번만 호출합니다.
6. 제공자 상태(provider status)와 오류 정보를 저장합니다.

재시도 시 레코드가 이미 `pending` 또는 `success` 같은 committed 상태라면 프록시를 다시 호출하지
말고 현재 원장 상태를 반환하세요.

## 운영 흐름

1. 제공자 프로모션 코드(provider promotion code)와 금액을 담은 캠페인 레코드를 만들거나 수정합니다.
2. Toss Console 설정이 준비된 뒤에만 캠페인을 `ACTIVE`로 바꿉니다.
3. 원장 상태, 제공자 오류 코드, 지급 건수, 남은 예산을 관찰합니다.
4. 의심스러운 제공자 실패를 재시도하기 전에 로컬 캠페인을 일시 중지하거나 소진 처리합니다.

## 프록시 요청

DB 기반 캠페인을 쓰는 앱은 요청마다 캠페인 값을 전달해야 합니다.

```json
{
  "providerRequestId": "app-feature:user-or-eligibility-id",
  "promotionCode": "toss-console-promotion-code",
  "amount": 50,
  "tossUserKey": "sealed-user-key-after-unseal"
}
```

`promotionAmount`는 `amount`의 호환 alias로 허용되지만, 새 호출자는 `amount`를 우선
사용하세요.

Toss가 상위 오류 코드(upstream error code)를 반환하면 프록시는 정리된 `providerErrorCode`를 반환합니다.
앱은 제공자 신호(provider signal)를 보수적으로 해석해야 합니다.

- `4112`, `4116`: 캠페인을 `EXHAUSTED`로 표시합니다.
- `4104`, `4105`, `4108`, `4109`: 캠페인을 일시 중지합니다.
- `4114`: 설정 오류로 보고, 재시도 전에 캠페인을 멈추거나 담당자에게 올립니다.
