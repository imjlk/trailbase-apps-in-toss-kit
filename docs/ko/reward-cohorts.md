# 보상 대상 구분과 포인트 자격

`trailbase_guest_common::reward_cohorts`는 사용자와 이용 시작 시점에 따라 포인트 보상을
제한합니다. 기존 사용자는 정해진 유예 종료 시각까지 포인트를 받고, 신규 사용자는 처음 N개
현지 날짜 동안 포인트를 받으며, 그 밖의 앱 자체 보상은 계속 동작합니다. 또한 포인트 조건을
충족한 시점의 내용을 스냅샷으로 남겨 이후 캠페인이나 기간이 바뀌어도 덮어쓰지 않습니다.
`templates/trailbase/sql/reward_subject_cohorts.sql`과
`templates/trailbase/sql/promotion_reward_eligibilities.sql`(`promotion_campaigns.sql` 필요)을
소비 앱의 새 마이그레이션으로 복사하세요. 두 테이블 모두 비공개로 유지합니다.

서버 DB 시각만 기준으로 사용합니다. 기기 시간, 로컬 저장소, 클라이언트의 "신규 사용자"
값이나 금액으로 대상·기간·금액·주기를 정하지 마세요. 모든 종료 시각은 exclusive입니다.

## 정책

```rust,ignore
use trailbase_guest_common::reward_cohorts::RewardCohortPolicy;
// 한국 날짜 기준. 1일차에 처음 이용하면 8일차 00:00 전까지 새 포인트 자격을 얻습니다.
let policy = RewardCohortPolicy::kst("reward-v1", new_user_cutover_at, legacy_points_earn_ends_at, 7);
policy.validate()?;
```

| 필드 | 의미 |
| --- | --- |
| `new_user_cutover_at` | 이 시각 전에 처음 이용하면 `LEGACY`, 이후면 `WELCOME` |
| `legacy_points_earn_ends_at` | 모든 기존 사용자의 새 포인트 자격 종료 시각(exclusive) |
| `welcome_point_days` | 첫날을 1일차로 세는 신규 포인트 기간(현지 날짜 수) |
| `utc_offset_ms` | 날짜 경계 오프셋. `kst()`는 `KST_OFFSET_MS` 사용 |

모든 시각이 정해지기 전에는 정책을 활성화하지 말고, 배포일을 기본값으로 쓰지 마세요.
유예기간은 실제로 공지가 시작된 시점부터 계산하며, 앱이 공지할 수 없었던 과거 날짜부터
진행된 것으로 처리하지 않습니다. `legacy_points_earn_ends_at` 변경은 모든 기존 사용자에게
적용되고, 신규 사용자는 등록 당시의 종료 시각을 유지합니다.

## 대상 등록

`register_reward_subject_tx(tx, subject_key, first_seen_at, &policy, now)`는 대상마다 한 행을
저장하고 반환합니다. 처음 등록한 값이 유지됩니다. 재접속, 프로필 재생성, 재설치, 정책 버전
변경, 캠페인 변경으로 이동하거나 다시 시작하지 않습니다.

- `subject_key`는 재설치와 계정 재생성에도 바뀌지 않아야 합니다. 예를 들어 검증된 익명
  식별자의 범위 HMAC을 사용합니다. 저장되는 값은 `reward_subject_hash(subject_key)`뿐입니다.
  원시 토스 user key를 넘기거나 로그에 남기지 말고, hash를 응답에 포함하지 마세요.
- 업데이트 후 첫 요청 시각이 아니라 원래 프로필 `created_at`처럼 확인 가능한 가장 이른 최초
  이용 시각을 넘기세요. 기존 프로필은 전환 전에 bootstrap/status에서 지연 등록하거나 guest
  job으로 등록하고, 마이그레이션 실행 시각으로 채우지 않습니다. 이력이 이미 삭제된 사용자는
  복원할 수 없으므로 과거 시각을 만들지 말고 그 한계를 기록하세요.
- 테이블에 `_user` 참조가 없으므로 탈퇴 후 재가입해도 신규 기간이 다시 열리지 않습니다.
  앱의 보존 정책은 명시적으로 적용하세요.

`point_window(&policy, now)`는 `LEGACY_GRACE`, `WELCOME`, `ENDED`와 exclusive `endsAt`을
반환합니다. 상태 응답에 사용하고, 포인트가 끝나도 다른 보상·출석·광고 필드는 그대로
유지하세요.

## 자격 스냅샷

서버가 포인트 조건을 충족하는 이벤트(출석 또는 복구 커밋)를 인정할 때, 같은 트랜잭션에서
서버가 지금 선택할 캠페인으로 `record_point_eligibility_tx`를 호출합니다. 공급자 코드와 금액은
같은 SQL 문에서 해당 `promotion_campaigns` 행으로부터 복사됩니다.

```rust,ignore
let record = record_point_eligibility_tx(&mut tx, &user_id, &subject, &policy, &PointEligibilityInput {
    reward_kind: "attendance_weekly",
    period_start: cycle_start,
    period_end: cycle_end,
    campaign_id: &campaign.id,
    earned_at: now,                     // 출석 일자가 아니라 커밋 시각
    claim_deadline_at: local_day_start(cycle_end + 7, KST_OFFSET_MS),
    max_per_subject: Some(1),           // 예: 신규 연속 출석 보상 1회
}, now)?;
```

| 결과 | 의미 |
| --- | --- |
| `RECORDED` | 새 스냅샷. 금액은 캠페인의 현재 금액 |
| `EXISTING` | 같은 소유자가 같은 기간을 이미 보유. 변경 없이 반환 |
| `WINDOW_CLOSED` | `earned_at`이 대상의 기간 종료 이후. 기록하지 않음 |
| `OVERLAPPING` | 같은 대상이 다른 기록에서 같은 기간이나 겹치는 기간을 이미 보유 |
| `LIMIT_REACHED` | 이 종류의 스냅샷이 `max_per_subject`만큼 이미 존재 |

- 기간 안에 충족한 스냅샷은 기간이 끝나도 유지됩니다. 최초 신청은 `claim_deadline_at`까지
  가능하므로 7일차에 완성한 연속 출석을 8일차에도 신청할 수 있습니다. 기간 확인에는
  `earned_at`을 쓰므로 기간 종료 후 복구로 과거 주기의 새 자격을 만들 수 없습니다.
- 최초 신청은 저장된 캠페인, 공급자 코드, 금액을 사용합니다. 더 새로운 캠페인이 활성이라는
  이유만으로 `CAMPAIGN_CHANGED`를 반환하지 말고, 다른 캠페인의 금액으로 바꾸지 마세요. 저장된
  캠페인의 예산과 공급자 상태는 계속 확인하고, 예산 소진이나 프로모션 종료를 명시적으로
  안내합니다.
- 기록은 예산을 예약하거나 지급을 보장하지 않습니다. 공급자 지급이 성공하기 전에는 "적립
  확정"이 아니라 "수령 조건을 충족했어요"와 캠페인 상태를 함께 표시하세요.
- 최초 신청은 프로모션 원장 행을 넣는 트랜잭션에서
  `mark_point_eligibility_claimed_tx(tx, user, id, ledger_id, now)`로 연결합니다. 같은 원장 ID는
  재전송으로 처리되고, 다른 ID는 충돌하며, 신청 기한이 지난 미신청 스냅샷은
  `POINT_ELIGIBILITY_CLAIM_EXPIRED`로 실패합니다. 기존 원장 행의 상태 확인과 재처리는 최초
  신청이 아니므로 기간이나 기한으로 막으면 안 됩니다.
- `list_point_eligibilities_tx`는 내역 화면용으로 소유자의 최근 스냅샷을 반환합니다.
  직렬화 결과에는 공급자 프로모션 코드가 포함되지 않습니다.

## 운영 참고

- 대상별 기간 종료는 서버의 자격 제한입니다. 다른 대상이 계속 사용하는 콘솔 프로모션을
  종료하지 않습니다. 콘솔 프로모션을 종료하거나 교체하기 전에 미신청 스냅샷, 남은 최초 신청
  기한, pending 원장 행을 확인하고, 스냅샷이 참조하는 캠페인 행은 보존하세요.
- 전역 프로모션 차단 플래그는 대상 제한의 대체 수단이 아닙니다. 보통 미결 신청의 재확인도
  함께 멈춥니다. 광고 스킵권 같은 앱 자체 보상은 이 플래그와 독립적으로 유지하세요.
- 스냅샷은 계정 삭제 시 `subject_hash`를 유지하고 `user_id`를 `NULL`로 바꾸므로, 재가입한
  같은 식별자는 이미 받은 기간에 대해 `OVERLAPPING`을 받습니다.

Kit 테스트는 한국 날짜 경계, 첫날 포함과 8일차 exclusive 종료, 기존 사용자 유예 변경, 최초
등록 유지, 스냅샷 이후 캠페인 금액 변경, 기간·겹침 거절, 대상별 한도, 신청 연결과 기한,
계정 삭제 후 재가입을 다룹니다.
