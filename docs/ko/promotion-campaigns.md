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

운영자가 입력하는 승인 근거가 필요하면
`templates/trailbase/sql/promotion_campaign_approvals.sql`을 소비 앱의 별도 migration으로
복사하세요. 이 테이블은 campaign별 분류, 기록된 승인 상태, 승인 확인 대상 앱 설정 revision,
비공개 근거 참조, 월간 보고 대상 여부를 revision별로 보관합니다. 테이블은 비공개이며 provider
promotion code를 저장하지 않습니다. 승인 상태는 운영자가 입력해야 하며 SDK 호출, 테스트
프로모션 성공, provider 응답만으로 `APPROVED`로 바꾸면 안 됩니다. 자체재화 원장의
`policy_version`과 이 승인 기록의 `revision`은 회계 평가 기준과 프로모션 승인이라는 서로 다른
사실이므로 분리하세요.
`UNCONFIRMED` 또는 `PENDING` 기록은 설정 revision과 근거 참조를 비워 둘 수 있지만, 결정된
상태에는 검토 시각과 두 참조가 모두 필요합니다.
이미 첫 초안의 테이블을 복사한 소비 앱은
`templates/trailbase/sql/promotion_campaign_approvals.v2.sql`을 명시적인 forward migration으로
한 번 적용하세요. `CREATE TABLE IF NOT EXISTS`를 다시 실행해도 기존 SQLite 테이블 구조는
바뀌지 않습니다.

공유 SQL 템플릿은 운영 화면처럼 여러 상태를 함께 보는 경로를 위해 `feature_key/status` index를
유지하고, provider 지급 전 hot lookup에는 `ACTIVE` partial index를 추가합니다. 활성 캠페인
해석은 사용량 확인 및 원장 상태 전이와 같은 앱 소유 transaction 안에서 처리하고, provider
promotion code나 원본 Toss 식별자는 RN client에 노출하지 마세요.

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

기본 정규화기는 모순된 claim 응답을 거부합니다. 명시된 상태와 성공 플래그가 서로 맞아야 합니다.
다만 이미 지급된 상태가 명시된 경우 `granted: false`는 이번 시도에서 새 지급이 없었다는 뜻일 수
있으므로 허용하며, 정규화 결과는 `granted`와 `alreadyGranted`를 모두 `true`로 반환합니다. 응답에
명시된 `campaignId`는 요청한 캠페인과 일치해야 합니다. 호환성을 위해 응답에 캠페인 ID가 없을 때는
요청한 ID를 사용할 수 있습니다. `normalizeResponse`를 직접 주입한 소비자는 기본 정규화기를 거치지
않으므로 자신의 응답 정합성 검사를 책임집니다.

## React Native 읽기 전용 상태 조회 client

claim에 공개 request ID가 생긴 뒤에는 React Native 앱에서 추가 지급을 시작하지 않고 앱이
소유한 상태 조회 endpoint를 호출할 수 있습니다.

```ts
const status = createAppsInTossPromotionStatusClient({
  statusEndpoint: "/api/app/v1/promotions/status",
});

const result = await status.getStatus({
  campaignId: "daily-attendance",
  requestId: "daily-attendance:claim-123",
});
```

이 client는 `campaignId`와 공개 `requestId`만 보냅니다. claim, prepare, execute endpoint를
호출하지 않고 ledger row를 삽입하지 않으며, 요청을 재시도하거나 제공자 request/transaction ID를
노출하지도 않습니다. 한 번의 호출은 한 번의 조회로 끝나므로 polling이 필요하면 소비자가 다음
조회 시점을 직접 예약하세요. `PENDING`은 그대로 pending으로 남고, 네트워크 오류와 `403`, `404`
응답은 `FAILED`로 바꾸지 않고 request error로 전달합니다.

앱이 소유한 endpoint는 현재 사용자를 인증하고 해당 campaign과 공개 request ID가 그 사용자에게
속하는지 확인해야 합니다. 기본 응답에는 같은 공개 `campaignId`와 `requestId`가 있어야 하며,
정규화기는 ID가 없거나 달라진 응답을 거부합니다. `normalizeResponse`를 직접 주입하면 claim 응답과
마찬가지로 소비자가 이 응답 계약을 책임집니다.

최신 기록된 승인과 현재 앱 설정 revision을 비교하려면
`templates/trailbase/sql-editor/owned-currency-report.sql`의 읽기 전용
`approval_scope_check` 예문을 사용하세요. 이 query는 근거 누락·미확정 상태를 표시할 뿐 campaign
상태를 바꾸거나 지급 흐름을 중단하지 않습니다. 운영상 중단이 필요하면 기존
`operation_policies` 제어를 사용하세요.

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

지급은 영속 3단계 계약만 사용하며, 단일 호출 grant 요청 형태는 제거되었습니다.
execute 요청은 원장 행 자체의 문맥을 전달합니다.

```json
{
  "providerTransactionKey": "실행-전에-저장한-키",
  "promotionCode": "toss-console-promotion-code",
  "amount": 50,
  "tossUserKey": "sealed-user-key-after-unseal"
}
```

`promotionAmount`는 `amount`의 호환 alias로 허용되지만, 새 호출자는 `amount`를 우선
사용하세요. `providerRequestId`는 상관관계 전용이며 외부 지급을 멱등하게 만들지
않습니다.

Toss가 상위 오류 코드(upstream error code)를 반환하면 프록시는 정리된 `providerErrorCode`를 반환합니다.
앱은 제공자 신호(provider signal)를 보수적으로 해석해야 합니다.

- `4112`, `4116`: 캠페인을 `EXHAUSTED`로 표시합니다.
- `4104`, `4105`, `4108`, `4109`: 캠페인을 일시 중지합니다.
- `4114`: 설정 오류로 보고, 재시도 전에 캠페인을 멈추거나 담당자에게 올립니다.

## 실행 전에 거래 키를 저장하기

이것이 유일한 신규 지급 흐름입니다. 원장은 execute 호출 전에 제공자 거래 키를
저장해, 충돌이나 응답 유실이 결과를 추적할 유일한 단서를 잃지 않게 합니다. 3단계
프록시 헬퍼(`apps_in_toss_proxy::promotion_reward_prepare`,
`promotion_reward_execute`, `promotion_reward_status`)와
`trailbase_guest_common::promotion_rewards`의 원장 헬퍼를 함께 사용하세요.

1. **검증 후 pending 원장 행 삽입**(`insert_promotion_reward_ledger_tx`):
   사용자, 캠페인, 금액, source, `provider_request_id`가 멱등 문맥입니다. 같은
   request id라도 다른 사용자·금액·캠페인은 병합되지 않고 거절됩니다. 행은 삽입
   시점에 `protocol = 'three-step'`로 표시됩니다. 이 transaction을 네트워크 호출
   동안 유지하지 마세요.
2. **prepare**(`promotion_reward_prepare`): 수신자를 정확히 하나
   (`userKey`/`tossUserKey`/`anonKey`) 전달하면 그 수신자에 바인딩된 키를 발급하고
   다른 것은 하지 않습니다. 이 단계의 `ok: true`는 키 발급을 뜻할 뿐 지급이
   아닙니다.
3. **키 저장 후 커밋**(`store_promotion_transaction_key_tx`): 실행을 시작하지 않은
   pending 행에 키를 저장하고 `three-step`으로 표시합니다. 실행 시작 전이라면 같은
   키 재저장은 멱등이고, 다른 키 저장은 거절됩니다
   (`PROMOTION_TRANSACTION_KEY_CONFLICT`). 기존 키를 덮어쓰지 않습니다. 저장은
   실행 표식이나 제공자 결과를 건드리지 않습니다. 이 커밋이 실패하면 execute를
   호출하지 마세요.
4. **실행 클레임 후 커밋**(`begin_promotion_reward_execute_tx`):
   `execution_started_at`을 원자적으로 기록합니다 — 외부 execute 호출 전에 자체
   transaction으로 커밋됩니다. 표식은 한 번만 기록됩니다. 정확히 한 worker만
   클레임할 수 있고, 동시 두 번째 클레임·클레임 후 재시작·늦은 재시도는 모두
   `None`을 받으며, 종결된 행은 다시 진입하지 않고, 클레임된 행을 실행 전 상태로
   되돌리는 것은 불가능합니다(`PENDING` 제공자 상태는 실행 전의 근거가 아닙니다).
5. **execute**(`promotion_reward_execute`): 저장된 키와 원장 행 자체의
   수신자·금액 문맥으로 호출합니다. 클라이언트가 제공한 금액·수신자·키로 실행하지
   않습니다. 이 헬퍼는 거래 키 없는 페이로드를 네트워크 호출 전에 거절합니다.
6. **응답 반영**(`apply_promotion_reward_outcome_tx`): 새 transaction에서
   반영하거나, 응답을 잃었다면 `promotion_reward_status`와 저장된 키로 복구합니다.
   이 문은 행 자신의 `provider_request_id`에만 매칭되고, 저장된 키를 다른 키로
   덮어쓰지 않으며, `protocol`/`execution_started_at`을 건드리지 않고, 확정된
   `success` 행은 늦은 pending/unknown 응답으로 되돌리지 않습니다.

실행 사실과 제공자 결과는 별도 컬럼에 저장됩니다. `protocol`은 신규 계약 행을
표시하고(레거시 grant 흐름의 행은 `NULL`로 남습니다), 한 번만 기록되는
`execution_started_at`은 커밋된 실행 시작을 기록하며, `provider_status`는
제공자가 관찰한 결과만 담습니다. `SUBMITTED`(execute 접수, 미확정)와
`UNKNOWN`(결과 확인 불가 — `ok:false` UNKNOWN 봉투 포함)은 둘 다 원장 행을
`pending`으로 유지하며 `granted_at`/`failed_at`을 만들지 않습니다. 확정 지급도
확정 실패도 아니며, `NOT_FOUND` status(해당 키의 지급 기록 없음)는 실패으로
분류됩니다. 재조회 대상은 `promotion_reward_ledgers_awaiting_recovery_tx`가
제공합니다 — 실행을 시작했고, 저장 키와 원래 문맥이 있으며, 결과가 아직 확정되지
않은 three-step 행. PENDING·SUBMITTED·UNKNOWN 행 모두 해당되고, 실행 전 행과
레거시 행은 절대 해당되지 않습니다. 재조회는 status만 호출하며 새 키 발급도
재실행도 하지 않고, 조회 실패나 NOT_FOUND 판정은 새 지급의 허가로 사용하지
않습니다. 3단계 이후 4단계 이전의 재시작은 같은 저장 키로 4단계에서 이어지고(두
번째 prepare도 중복 지급도 없습니다), 4단계 이후 충돌한 행은 재조회 대상에
남으므로 운영 판단 전에 status 조회로 마무리하세요.

기존 단일 호출 grant endpoint와 Rust 헬퍼는 제거되었습니다. 프록시는 옛 라우트에
업스트림을 건드리지 않고 `410 PROMOTION_GRANT_REMOVED`로 응답합니다. claim
핸들러를 위 순서로 전환하세요.

## 기존 지급 결과 확인

반환된 `providerTransactionKey`를 promotion ledger에 저장하세요.
`apps_in_toss_proxy::promotion_reward_status`에 같은 campaign, 수신자, request id와
transaction key를 전달하면 `POST /internal/apps-in-toss/promotion/reward/status`를
호출합니다. 이 endpoint는 기존 키가 필수이며 Toss execution-result만 조회합니다.
새 키를 만들거나 지급을 다시 실행하지 않습니다. 결과는 기존 원장 행에 반영하세요.
프록시는 관찰된 판정(`GRANTED`, `PENDING`, `FAILED`, `NOT_FOUND`, `UNKNOWN`)을
그대로 전달하고 분류는 원장이 결정합니다.

제거된 grant 흐름에서는 통신이 끊기면 호출자가 저장하기 전에 키를 잃을 수
있었습니다. 그런 레거시 행(`protocol IS NULL`, 키 없음)은 재조회 대상이 아니며
자동으로 전환되지도 않습니다 — 운영자·제공자 정산으로 해결하고, 같은 원장 행에
새 키로 재시도하지 마세요. 결과 조회 endpoint가 어떤 흐름도 네트워크 중단에 대해
원자적으로 만들지는 않습니다.

## 원장 스키마 v2 업그레이드

영속 3단계 계약은 실행 사실을 `protocol`과 `execution_started_at` 두 새 컬럼에
저장합니다. 신규 설치는 `templates/trailbase/sql/promotion_reward_ledger.sql`에서
컬럼을 받습니다. 기존 설치는 `templates/trailbase/sql/promotion_reward_ledger.v2.sql`을
명시적 마이그레이션으로 한 번 적용합니다 (SAVEPOINT로 감싸져 실행돼 마이그레이션 러너 안에서도 동작). 추가 전용입니다 — 기존 지급 행, 거래
키, 사용자·source·캠페인 연결, 제공자 결과가 보존되고, 레거시 행은 추측으로
표시하지 않고 `protocol IS NULL`로 남습니다. 프로토콜 백필은 실행하지 않습니다.
`PREPARED` 레거시 행은 실행 전이라 증명되지 않습니다(0.11 저장 펜스가 `PENDING`도
허용해, 실행 후 PENDING 행이 저장 재생 뒤 `PREPARED`로 읽힐 수 있습니다). 따라서
**업그레이드 전에 드레인하세요** — 0.11 헬퍼가 살아 있는 동안, 모든 레거시 행(키
유무와 PREPARED 포함)을 **status 조회 또는 명시적 정산으로만** 마무리합니다.
PREPARED는 미실행 키와 재생된 실행 후 상태를 구분할 수 없고, 키 없는 레거시 행도
호출자가 키를 저장하기 전에 실행된 지급일 수 있어 resume이나 재채택은 이중 지급이
될 수 있습니다. v2 키 저장은 v2 흐름이 만든 행만 받습니다. 장기
호환 분기는 없습니다. 이 breaking 릴리스 이후 헬퍼는 v2 컬럼을 기대합니다.

[검증된 익명 사용자 식별·발송·복구](anonymous-identity.md)를 참고하세요.

## 수신자 종류를 명시적으로 선택하기

익명 수신자는 `promotion_reward_prepare_payload(PromotionRecipient::AnonymousKey(key))`,
토스 로그인 수신자는 `PromotionRecipient::TossUserKey(key)`를 사용합니다. 실행·조회에서도
동일한 수신자를 `PromotionRewardRequest`에 넣고 `promotion_reward_payload_for_recipient`로
요청을 만드세요. 이 요청은 비어 있지 않은 저장된 `provider_transaction_key`를 요구하며,
helper 자체가 지급 키를 발급하거나 포인트를 지급하지 않습니다.

```rust
use trailbase_guest_common::promotion_rewards::{
    PromotionRecipient, PromotionRewardRequest,
    promotion_reward_prepare_payload, promotion_reward_payload_for_recipient,
};

let recipient = PromotionRecipient::AnonymousKey(anonymous_key);
let prepare_payload = promotion_reward_prepare_payload(recipient)?;
// prepare 응답의 키와 수신자 연결을 저장하고, execute 전에 실행 클레임을 커밋합니다.
// HTTP 요청 중 DB transaction을 유지하지 않습니다.
let payload = promotion_reward_payload_for_recipient(PromotionRewardRequest {
    provider_request_id: request_id,
    provider_transaction_key: stored_transaction_key,
    promotion: &promotion_context,
    requested_at,
    recipient,
    eligibility_id: None,
    user_id: None,
    source_type: Some("daily-reward"),
    source_id: None,
})?;
// 신규 실행은 promotion_reward_execute를 한 번 호출합니다.
// 이미 실행한 요청은 promotion_reward_status_with_payload로 조회합니다.
```

기존 `PromotionRewardPayloadInput` / `promotion_reward_payload`의 호출 방식과 JSON은
호환성을 유지하지만 **토스 로그인 전용**입니다. `toss_user_key`는 항상 `tossUserKey`로
직렬화되므로 익명 키를 넣으면 잘못된 인증 헤더가 선택됩니다. 신규 구현에서는 로그인
payload를 만든 뒤 고치는 대신 명시적 수신자 API를 사용하세요. 수신자 타입에는
`Debug`/`Serialize`가 없지만 최종 JSON에는 식별자가 포함되므로 기록하면 안 됩니다.

helper는 수신자 저장·소유권 검증·원장 연결을 대신하지 않습니다. 거래 키와 원래 수신자
연결을 함께 유지하고 재시작이나 로그인 변경 후에도 해당 연결을 사용하세요. 실패 또는
불명확한 응답만으로 실행 상태를 초기화하거나 새 지급 키를 발급하면 안 됩니다.

배포 전 [프로모션 호환성 점검](release-doctor.md#프로모션-배포-전-점검)을 실제 실행 중인
비공개 프록시에 수행하세요. 이미지 태그만 확인해서는 안 됩니다.
`bun test scripts/promotion-recipient-contract.test.mjs`는 실제 Rust helper가 만든 요청을
프록시에 전달하고 익명·로그인 수신자의 최종 헤더와 거래 키 연결을 loopback 가짜 서버로 검증합니다.
