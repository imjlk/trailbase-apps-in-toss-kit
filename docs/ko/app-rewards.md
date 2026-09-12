# 앱 자체 광고·공유 보상

`trailbase_guest_common::app_rewards`는 앱 자체 보상을 위한 서버 발급 시도와 로컬 지급
원장을 제공합니다. `templates/trailbase/sql/app_reward_attempts.sql`을 소비 앱의 새
마이그레이션으로 복사하고 WASM guest를 재빌드하세요. 두 테이블은 비공개로 유지하며
Record API collection이나 view에 노출하지 않습니다. 기존 마이그레이션을 수정할 필요는 없습니다.

시도에는 인증된 TrailBase 사용자, placement, 보상 출처, 서버 정책 버전, 수량, 단위,
만료 시각을 묶습니다. 서버는 192비트 난수 ID를 발급합니다. 고유 시도 ID를 가진 지급
행 **자체가 앱 재화 지급**입니다. Claim과 선택적인 잔액 projection은 하나의 SQLite
트랜잭션으로 커밋하며, 커밋 후 다른 결제·지급 서비스를 호출하지 않습니다. 사용 내역과
projection은 소비 앱이 소유하고 같은 지급을 중복 집계하지 않아야 합니다.

## 신뢰와 정책

SDK의 [보상형 광고 이벤트](https://developers-apps-in-toss.toss.im/bedrock/reference/framework/광고/IntegratedAd.html)는
클라이언트 트리거입니다. 시도 ID, `earned`, 경과 시간, 클라이언트 보상 수량은 광고 시청의
증명이 아닙니다. 발급에는 서버의 보상 제안 정책이, claim에는 별도의 서버 자격 정책이
필수입니다. 기본 허용 동작은 없습니다. 현재 기능 상태, 사용자 자격, placement, 정책 버전,
트랜잭션 내 한도를 검사하고 소비 앱이 명시적으로 정한 위험 정책에 따라 승인하세요.
독립적인 증거가 필요한데 확보할 수 없다면 거절합니다. Kit이 앱인토스의 서버 광고 검증
API를 제공하는 것은 아닙니다.

[공유 리워드](https://developers-apps-in-toss.toss.im/bedrock/reference/framework/친구초대/contactsViral.html)는
설정된 보상 이벤트를 전달합니다. 콘솔·연동 설정에서 앱 자체 보상인지 플랫폼 지급인지
구분하고, 앱 자체 재화만 이 원장으로 처리하세요. 플랫폼이 지급하는 이벤트에 로컬 재화나
결제를 중복 지급하지 않습니다. 일반 공유 시트가 닫힌 것은 공유 완료 확인이 아닙니다.
어댑터는 이벤트를 정규화하며 클라이언트 관찰을 서버에서 신뢰할 증거로 바꾸지 않습니다.

## 엔드포인트 계약

**세 엔드포인트 모두** 인증하고 비활성화·철회된 사용자를 차단합니다. 사용자 ID는 요청
본문이 아닌 검증된 세션에서 읽으세요. 발급·claim 요청 빈도를 제한합니다. 만료 시각은
클라이언트 시계가 아닌 서버 DB 시각으로 결정합니다.

1. `POST /app-rewards/attempts`: placement 선택값을 받습니다. 서버에서 허용된 출처와
   보상을 결정한 뒤 필수 정책 closure와 함께 `issue_app_reward_attempt_tx`를 호출합니다.
   커밋 후 시도를 반환하고, SDK 실행 전에 계정·placement별로 해당 ID를 저장합니다.
2. `POST /app-rewards/attempts/:id/claim`: ID와 placement 선택값을 받습니다.
   `claim_app_reward_attempt_tx`에 서버 정책 closure를 전달합니다. 헬퍼는 소유자,
   placement, 만료를 검사하고, closure는 같은 트랜잭션에서 최신 자격·정책 버전·수량·한도를
   검사합니다. 모든 오류에서 전체 트랜잭션을 롤백합니다.
3. `GET /app-rewards/attempts/:id`: 같은 사용자와 placement로
   `find_app_reward_attempt_tx`를 호출합니다. `grantedAt != null`이면 커밋된 지급 영수증이며,
   null이고 `expiresAt <= serverNow`이면 만료, 나머지는 대기 중입니다.

Claim 재호출은 만료 후에도 새 지급 정책을 실행하지 않고 원래 영수증을 반환합니다.
다른 사용자나 placement는 기록을 조회하지 못합니다. 신규 진입을 중단해도 영수증 조회는
유지하며, 아직 지급되지 않은 claim에는 현재 서버 차단 정책을 적용합니다. 응답을 잃으면
같은 시도를 조회하고 새로 발급하지 않습니다. 발급 요청 재시도는 두 번째 시도를 만들 수
있으므로 발급·지급 한도는 시도 ID를 넘어 같은 자격 기간의 추가 보상을 막아야 합니다.

```rust,ignore
// 인증된 WASM 핸들러 내부입니다. app_* 검사는 소비 앱 정책입니다.
let mut tx = trailbase_guest_common::db::tx()?;
let now = trailbase_guest_common::db::now_ms_tx(&mut tx)?;
let result = trailbase_guest_common::app_rewards::claim_app_reward_attempt_tx(
    &mut tx, &principal_id, &placement, &attempt_id, now,
    |tx, attempt| {
        // 서버 상태·증거만 사용합니다. 클라이언트 수량·earned·시간은 근거가 아닙니다.
        app_reward_eligible_tx(tx, &principal_id, attempt, now)
    },
)?; // 오류가 나면 전체 트랜잭션을 롤백해야 합니다.
trailbase_guest_common::db::tx_commit(&mut tx)?;
// result를 반환합니다. 원장 행이 이미 지급이므로 여기서 다시 지급하지 않습니다.
```

지갑 projection을 쓰려면 같은 트랜잭션에서 고유 `attempt_id` 처리 표시와 함께 반영합니다.
중복 claim 영수증이 잔액을 다시 늘려서는 안 됩니다. 가장 단순한 참조 잔액은 사용자·단위별
커밋된 grant/attempt join의 수량 합계에서 앱의 트랜잭션 기반 사용 원장을 뺀 값입니다.

## 보관과 검증

재화, 재호출, 한도, 대사에서 참조할 수 있는 시도와 지급은 삭제하지 않습니다. 사용자 삭제는
이 앱 자체 보상 행에도 연쇄 적용되므로 사용자 삭제 전에 앱의 보관·삭제 정책을 적용하세요.
이 원장을 토스 IAP, 프로모션 거래 키, 플랫폼 결제 대사 용도로 전용하지 않습니다.

테스트는 동일한 Rust 처리 흐름과 SQL을 SQLite에서 실행해 소유자·placement 제한, 만료,
정책 거절, 트랜잭션 한도, 중복 영수증, SQL 고유성, projection 실패 롤백, 사용자 삭제를
검증합니다. 합성 데이터만 사용하며 실기기 광고 증거를 검증했다고 주장하지 않습니다.
보상 활성화 전 소비 앱의 기기 검사와 독립적인 자격 정책이 필요합니다.
