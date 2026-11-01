# 광고 스킵권

`trailbase_guest_common::ad_skip_tickets`는 전면 광고 1회를 건너뛰는 앱 자체 스킵권의
잔액을 관리하고, 지급은 한 번만, 사용은 멱등하게 처리합니다.
`@trailbase-apps-in-toss-kit/ait-rn/ad-skip`은 클라이언트 쪽 사용 요청을 복구 가능하게
유지합니다. `templates/trailbase/sql/ad_skip_tickets.sql`을 소비 앱의 새 마이그레이션으로
복사하고 WASM guest를 재빌드하세요. 모든 테이블은 비공개로 유지하며 Record API
collection이나 view에 노출하지 않습니다.

스킵권은 앱 안에서 광고 1회를 건너뛰는 권리입니다. 양도·판매·현금 및 토스 포인트 전환이
불가하고 `promotion_reward_ledger`를 사용하지 않습니다. 사용해도 SDK 광고 이벤트, 노출,
보상 callback, 광고 세션이 생기지 않으며 광고 노출·완료·수익 지표나 일일 상한·쿨다운에
합산하면 안 됩니다. 이용 흐름을 측정할 때는 선택한 경로(광고, 스킵권, 무료)를 따로
기록하세요.

## 테이블

| 테이블 | 역할 |
| --- | --- |
| `ad_skip_ticket_wallets` | 계정별 서버 잔액. `balance >= 0`. 계정 삭제 시 함께 삭제 |
| `ad_skip_ticket_grants` | 지급 원인·기간당 한 행. subject, 원인, 기간별로 고유 |
| `ad_skip_opportunities` | 광고 기회당 하나의 처리 결과: `AD`, `TICKET`, `FREE` |
| `ad_skip_ticket_redemptions` | `(user_id, request_id)` 기준 영수증. 부분 고유 인덱스로 기회당 차감 1회만 허용 |

지급 행은 안정적인 앱 범위 식별자를 도메인 분리해 SHA-256으로 만든 `subject_hash`를
저장합니다([reward-cohorts.md](reward-cohorts.md) 참고). 이 값은 계정보다 오래 남으므로
탈퇴 후 재가입해도 같은 날짜나 주기를 다시 받을 수 없습니다. 잔액 자체는 일반적인 탈퇴
안내와 같이 계정 삭제 시 소멸합니다. 더 이상 다시 받을 수 없는 기간의 지급 행은 앱의
보존 정책에 따라 정리할 수 있습니다.

## 지급

`grant_ad_skip_tickets_tx`는 정상 출석 인정처럼 지급 조건이 되는 서버 이벤트를 기록하는
같은 트랜잭션에서 호출합니다. 별도의 "스킵권 받기" 엔드포인트는 두지 않습니다. 스킵권은
토스 프로모션 호출에 의존하지 않아야 합니다. 프로모션 실패, 예산 소진, 미등록이어도
출석과 스킵권은 그대로 유지됩니다.

```rust,ignore
// 인증된 출석 트랜잭션 안에서.
use trailbase_guest_common::ad_skip_tickets::{AdSkipGrant, grant_ad_skip_tickets_tx};
let daily_grant = AdSkipGrant {
    subject_key: &scoped_identity_hmac, // 재설치·재가입에도 바뀌지 않는 값
    cause: "daily_attendance",
    period_start: kst_day,
    period_end: kst_day,
    quantity: 1,
    policy_version: "reward-v1",
};
grant_ad_skip_tickets_tx(&mut tx, &user_id, &daily_grant, now)?;
if let Some((start, end)) = cycle_completed_now {
    grant_ad_skip_tickets_tx(&mut tx, &user_id, &AdSkipGrant {
        cause: "streak_bonus", period_start: start, period_end: end, quantity: 3,
        ..daily_grant
    }, now)?;
}
```

- `Granted`는 수량을 더합니다. `AlreadyGranted`는 이 subject가 같은 원인·기간을 이미
  받았다는 뜻(재시도, 동시 요청, 이전 계정)이며 설정 수량이 바뀌었더라도 아무것도 바꾸지
  않습니다. `Overlapping`은 같은 원인의 다른 기간과 겹친다는 뜻이며 지급하지 않습니다.
- 스킵권 지급 시작 시각 이후에 발생한 이벤트에만 지급하세요. 과거 출석을 재생해 소급
  지급하지 않습니다. 시작 전에 시작해 시작 후 완료된 주기는 보너스를 한 번 받을 수 있습니다.
- 광고로 복구한 날짜에는 일일 스킵권을 주지 않습니다. 복구로 완성한 주기는 보너스를 한 번
  받을 수 있습니다. 일일 지급과 보너스는 서로 다른 원인이므로 7일차 출석은 둘 다 받습니다.

## 광고 기회

기회는 광고 안내 1회이며, 소비 앱이 서버에서 정한 `opportunity_key`로 구분합니다. 예를
들어 번호 생성 광고 주기는 `cycle:42`처럼 만들 수 있습니다. 다음 광고 안내에는 새 키를
사용해야 합니다. 기회마다 처리 결과는 최대 하나입니다.

- 보상형 광고 완료는 `claim_ad_opportunity_tx(..., AdOpportunityResolution::Ad, ad_session_id, now)`를
  호출합니다. no-fill처럼 안내를 무료로 정리하는 계속 이용은 `Free`를 사용합니다.
- `AlreadyResolved`가 반환되면 그 경로의 후속 효과를 건너뜁니다. 스킵권으로 이미 해결한
  기회에 늦게 도착한 광고 callback이 새 광고 구간을 만들면 안 됩니다.
- `Ticket`은 사용 처리만 기록합니다.

## 사용

`redeem_ad_skip_ticket_tx`는 하나의 트랜잭션에서 다음 순서로 동작합니다.

1. 이미 알려진 `request_id`는 원래 영수증을 `replayed: true`로 반환합니다. 같은 ID를 다른
   지면·키·context로 다시 쓰면 `AD_SKIP_REQUEST_CONFLICT`로 실패합니다.
2. `allowed_placements`에 없는 지면은 아무것도 바꾸기 전에 `AD_SKIP_PLACEMENT_NOT_ALLOWED`로
   실패합니다. 출석 복구 지면은 절대 넣지 마세요. 빈 목록을 넘기면 잔액과 지급 내역은
   유지한 채 사용만 중지합니다.
3. 이미 해결된 기회는 `consumed: 0`인 `ALREADY_RESOLVED`와 원래 처리 결과를 반환하므로
   클라이언트가 같은 효과로 연결할 수 있습니다.
4. 읽기 전용 `evaluate` closure가 판단합니다. `Free`(무료 횟수나 광고 압박 한도 등으로 지금
   광고가 필요 없음)는 차감 없는 영수증을 쓰고 기회를 해결 처리하지 않습니다. `Due`는 계속
   진행합니다. 하루 생성 한도처럼 기능 자체를 실행할 수 없으면 오류를 반환해 차감하지 않습니다.
5. 잔액이 없으면 `resolve` 실행 전에 `AD_SKIP_INSUFFICIENT_BALANCE`로 실패합니다.
6. `resolve`는 소비 앱의 광고 상태를 전환하고, 이번 호출이 현재 기회를 실제로 바꿨을 때만
   (예: cycle 행이 정확히 1개 갱신) true를 반환합니다. 아니면 `AD_SKIP_OPPORTUNITY_STALE`로
   실패하고 차감하지 않습니다.
7. 기회 처리 결과, 조건부 차감, 영수증은 마지막에 기록합니다.

모든 오류에서 롤백하세요. 스킵권을 위해 가짜 `userEarnedReward`를 만들거나 광고 완료
엔드포인트를 호출하지 않습니다.

| 코드 | 상태 | 의미 |
| --- | --- | --- |
| `INVALID_AD_SKIP_REQUEST` | 400 | 요청 ID, 지면, 키, context 형식 오류 |
| `AD_SKIP_PLACEMENT_NOT_ALLOWED` | 403 | 스킵권을 쓸 수 없는 지면 |
| `AD_SKIP_REQUEST_CONFLICT` | 409 | 다른 선택에 이미 쓰인 요청 ID |
| `AD_SKIP_INSUFFICIENT_BALANCE` | 409 | 사용할 스킵권 없음, 변경 없음 |
| `AD_SKIP_OPPORTUNITY_STALE` | 409 | 현재 기회가 아님, 차감 없음 |

요청 ID는 `A-Z a-z 0-9 _ -`로 된 16-128자입니다. 키, reference, 선택 context는
`A-Z a-z 0-9 . _ : -`를 사용합니다. context에는 원래 기능 요청 ID 같은 불투명한 계속
이용 값만 넣고 식별자나 토큰은 넣지 마세요. 클라이언트에는 영수증 필드(`receiptId`,
`resolution`, `consumed`, `balance`, `replayed`, `opportunity`, `context`)를 반환합니다.
serde 출력이 이미 이 camelCase 이름을 사용합니다.

## 클라이언트

```ts
import {
  createAdSkipRedemptionClient,
  createAdSkipRedemptionController,
  resolveAdSkipChoice,
} from "@trailbase-apps-in-toss-kit/ait-rn/ad-skip";

const client = createAdSkipRedemptionClient({ baseUrl, getAuthHeaders, redeemEndpoint: "/api/app/v1/ad-skips/redeem" });
const adSkips = createAdSkipRedemptionController({ redeem: client.redeem, storage, storageKey: "app.adSkips" });
adSkips.setBalance(status.adSkipBalance); // 공통 상태 응답에서

const outcome = await adSkips.redeem({ placement: "generation_continue", opportunityKey, context: generationRequestId });
if (outcome.status === "resolved") {
  await adSkips.applyEffectOnce(outcome.receipt, () => generationCounter.continued());
  // 이후 원래 요청 ID로 기존 기능을 이어서 실행
}
```

- 컨트롤러는 요청 ID를 전송 전에 저장하고, 타임아웃·네트워크 오류·401/408/425/429/5xx는
  `maxAttempts`까지 같은 ID로 재시도하며, 결과를 모르면 앱 재시작 후에도 대기 상태로
  보관합니다. 시작 시 또는 수동 "결과 다시 확인"에서 `retryPending()`을 호출하세요. 화면
  닫기나 요청 취소는 환불이 아닙니다.
- `isBlocked(placement, key)`는 결과가 전송 중이거나 불명확한 동안 true입니다. 앱 전체가
  아니라 그 기회에 대한 새 스킵권 요청과 광고 실행만 막으세요.
- `applyEffectOnce`는 효과를 실행하기 전에 영수증의 효과 키를 저장하므로, 응답 재시도나
  재시작으로 다음 광고 구간을 두 번 추첨하지 않습니다.
- `resolveAdSkipChoice`는 버튼 상태를 제공합니다. 허용 목록 밖 지면(예: 출석 복구)에는
  스킵권 선택을 표시하지 않고, 확인 중·결과 확인 중·처리 중에는 비활성화하며, 보유 0장은
  광고 선택을 막지 않고 안내만 합니다.
- 자동 사용을 넣지 마세요. 광고 보기를 선택한 사용자는 광고가 실패해도 그 선택을
  유지합니다. 처음부터 스킵권을 선택하면 광고 SDK를 호출하거나 광고를 미리 불러오지 않습니다.

## 검증

Kit 테스트는 같은 Rust 처리와 SQL을 SQLite에서 실행합니다. 일일·연속 보너스의 1회 지급,
기간 겹침과 재가입 방지, 계정 삭제, 재전송과 충돌하는 요청 ID, 차단된 지면, 잔액 없음,
오래된 소비 앱 상태와 롤백, 무료·이미 해결된 기회, 스킵권/광고 경합, 제약 조건 방어를
확인합니다. 클라이언트 테스트는 저장, 같은 ID 재시도, 재시작, 거절, 효과 1회 적용을
다룹니다. 소비 앱은 광고 안내와 카운터를 실제 기기에서 별도로 확인해야 합니다.
