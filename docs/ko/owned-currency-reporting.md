# 자체재화 보고

앱은 기존 보상과 잔액 구현을 유지하면서 회계상 사실을 공통 비공개 원장에
기록할 수 있습니다. 이 템플릿은 자체재화 프로모션의 월말 보고를 준비하기
위한 것입니다. 앱인토스의 프로모션 분류를 결정하거나 토스 콘솔에 보고서를
제출하지는 않습니다.

## 킷이 제공하는 것

`templates/trailbase/sql/owned_currency_events.sql`과
`templates/trailbase/sql/owned_currency_policies.sql`을 모두 소비 앱의
forward-only migration으로 복사해 사용하세요. `owned_currency_events` 테이블은
부호가 있는 정수 최소 단위의 회계 원장이고, `owned_currency_policies` 테이블은
정책 버전별 평가 방식, 평가액 단위, 유리수 전환율, 적용 구간을 저장합니다.
이벤트가 해당 버전을 참조하기 전에 정책 행을 먼저 채워야 합니다. 기존 소비 앱은
이 migration을 추가하고 복원할 수 있는 정책 이력을 backfill한 뒤 보고 CLI를
실행하세요. 킷 submodule을 업데이트해도 소비 앱에 복사한 migration은 자동으로
바뀌지 않습니다.

이 테이블은 public Record API에 노출하지 마세요. 선택적인 `_user` 참조는 사용자가
삭제되면 `NULL`이 되므로, 이후 마감 집계에 TrailBase 사용자가 남지 않습니다.
`source_id`와 `metadata_json`에는 원본 Toss user key, HMAC, sealed 값, 토큰,
비밀을 넣지 않아야 합니다.

이 원장은 잔액 projection이 아닙니다. 기존 앱 자체 잔액은 계속 앱이 소유합니다.
`app_reward_grants`의 행은 여전히 앱 보상이고, `promotion_reward_ledger`의 행은
여전히 토스 지급 원장입니다. 둘을 이 원장에도 복사한다면 같은 지급이 두 번 집계되지
않도록 안정적인 source와 idempotency key를 사용하세요.

## 이벤트 규칙

`ISSUE`와 `CONVERT_IN`은 양수입니다. `SPEND`, `CONVERT_OUT`, `EXCHANGE`,
`EXPIRE`는 음수입니다. `ADJUSTMENT`는 양수·음수 모두 가능하며 운영자가 승인한
원본을 가리켜야 합니다. 변환은 입력과 출력 행에 같은 `conversion_group_id`를
사용하며 출력 재화를 다시 발행량으로 세지 않습니다. 교환은 `exchange_id`를
사용하고, 예약 및 토스 지급 상태는 별도 교환 테이블과 기존 프로모션 원장에 둡니다.

변환·교환 식별자는 비어 있지 않고 앞뒤 공백이 제거된 값이어야 합니다. 안정적인 join
키이므로 adapter마다 다르게 정규화하지 마세요.

그램·포인트처럼 소수 값이 필요한 재화는 명시적인 `unit_code`와 정수 최소 단위로
저장하세요. 평가액도 정수로 저장하고 그 값을 계산한 `policy_version`을 함께 남깁니다.
현재 전환율이나 시세로 과거 값을 다시 계산하지 않습니다.

`idempotency_key`는 이 원장 안에서 전역적으로 유일합니다. 사용자 로컬 키가 전역적으로
유일하다고 가정하지 말고 앱·source·원본 이벤트 범위를 접두사로 포함하세요. source
검사 query는 서로 다른 멱등 키로 같은 source 작업을 기록한 경우도 찾아냅니다.

## SQL Editor 예문

`templates/trailbase/sql-editor/owned-currency-report.sql`의 읽기 전용 예문은
다음을 포함합니다.

- 반열린 구간 월별 집계(`period_start` 리터럴 포함, `period_end` 리터럴 제외)
- 특정 시각 기준 잔액
- 평가액 단위를 분리한 정책 버전별 집계
- 이벤트가 기록된 정책의 적용 구간을 벗어났는지 확인하는 정책 구간 검사
- 검증된 `CONVERT_IN`/`CONVERT_OUT` 한 쌍만 제외하는 중복 source 검사
- `MARKET_SNAPSHOT` 평가액 누락 검사
- 기준 시각의 짝이 맞지 않는 변환 그룹 검사

각 query의 timestamp 리터럴 두 개를 소비 앱 데이터베이스가 사용하는 단위로 바꾸세요.
예문은 운영자/admin SQL Editor 세션에서 실행하고, 보고서를 만들 때는 일관된 데이터베이스
snapshot을 사용해야 합니다.

```sql
-- 밀리초 데이터베이스의 예시 파라미터:
-- 1788192000000을 포함하는 기간 시작으로 바꾸세요.
-- 1790870400000을 제외하는 기간 종료로 바꾸세요.
```

예문은 발행량과 현재 잔액을 의도적으로 분리합니다. 한 달에 10,000개를 발행하고
6,000개를 교환했더라도 보고서의 발행량은 10,000개입니다.

## 읽기 전용 보고 CLI

runtime 패키지에는 `trailbase-owned-currency-report`도 포함되어 있습니다. 일관된
SQLite snapshot을 읽고 쓰지 않으면서, 비식별화한 JSON 또는 CSV를 출력합니다.
snapshot에는 `owned_currency_events`와 `owned_currency_policies`가 모두 있어야 합니다.

```bash
bun vendor/trailbase-apps-in-toss-kit/packages/trailbase-runtime/bin/owned-currency-report.mjs \
  --db path/to/trailbase.sqlite \
  --period-start 1788192000000 \
  --period-end 1790870400000 \
  --timestamp-unit milliseconds \
  --format json
```

스프레드시트나 제출용 작업표가 필요하면 `--format csv`를 사용하세요. 출력은 발행,
소진, 변환, 교환, 평가액 단위, 기준 시각 잔액을 분리하며 source ID나 사용자 식별자를
포함하지 않습니다. CSV의 기간 행에는 정책의 평가 모드, 유리수 전환 비율, 적용 구간도
남습니다. quality에는 정책 버전이 없거나 이벤트 시각이 해당 정책 버전의 적용 구간 밖인
이벤트, `MARKET_SNAPSHOT` 평가액 누락, 보고 기준 시각의 짝이 맞지 않는 변환 그룹도
포함됩니다. `NONE` 정책의 교환은 평가액이 없어도 누락으로 표시하지 않습니다. CSV의
마지막 `quality` 행에는 이 값이 들어가며, 기간, timestamp 단위, 생성 시각, CLI provenance를
담은 `metadata` 행도 포함됩니다. checkout의 추적 파일이 수정된 상태라면 CLI는 커밋된
`HEAD`에서 생성된 것으로 오인하지 않도록 `sourceCommit`을 비워 둡니다.
기존 결제 원장 진단은 계속
`trailbase-ledger-doctor`를 사용합니다.
두 명령 모두 토스에 제출하지 않고 실시간 데이터베이스도 변경하지 않습니다.

## 마감 manifest와 승인 근거

보고서 옆에는 별도의 JSON 마감 manifest를 보관하세요.
`templates/trailbase/release/owned-currency-close-manifest.example.json`을 복사한 뒤 예시 값을
바꿉니다. manifest에는 manifest와 보고서 schema version, 앱 식별명, 시작 포함·종료 제외 기간,
timestamp 단위, 시간대, 실제 보고서 바이트의 SHA-256, 비공개 snapshot 참조, source commit,
보고 도구 버전, policy version 목록, 승인 근거 revision, 그리고 다음 단계의 순서가 기록됩니다.

마감 manifest 검증기는 JSON 보고서 출력 바이트를 그대로 해시에 묶습니다. CSV는 사람이 보는
작업표·내보내기로 사용하고, manifest의 보고서로는 JSON 산출물을 검증하세요.

```text
GENERATED → REVIEWED → SUBMITTED
```

`SUBMITTED`는 운영자가 제출했다고 기록한 상태이며 토스가 보고서를 접수하거나 승인했다는 뜻이
아닙니다. 기록한 각 단계에는 별도 시각과 비공개 근거 참조가 필요합니다. 정정은 새
`reportRevision`으로 만들고 이전 revision을 `correctionOf`로 가리키며, 기존 manifest와 이벤트
행은 보존합니다. manifest에는 사용자 ID, Toss 식별자, promotion code, 인증정보, 보고서 파일
경로를 넣지 않습니다.

릴리스 handoff 전에 보고서 바이트와 manifest를 함께 검증하세요. runtime helper는 DB에 쓰지
않고 해시, 기간, timestamp 단위, source, policy, 단계 순서, 근거 참조 불일치를 거부합니다.
Release Doctor에는 다음 선택적 check를 추가할 수 있습니다.

```json
{
  "type": "owned-currency-close-manifest",
  "name": "Owned currency close evidence",
  "manifest": "apps/trailbase/reports/2026-09.manifest.json",
  "report": "apps/trailbase/reports/2026-09.json",
  "required": false
}
```

보고서와 manifest 경로는 Release Doctor 설정에만 두고 manifest 자체에는 기록하지 않습니다.
소비 앱에 운영자 소유 승인 절차가 생길 때까지는 이 check를 선택적으로 두고, 준비가 끝난 뒤
required로 올리세요.

## 월말 작업 순서

1. 앱 adapter가 모든 원본 이벤트와 정책 버전을 기록했는지 확인합니다.
2. 일관된 snapshot에서 SQL Editor 월별 집계를 실행합니다.
3. 변환 그룹, 교환 상태, 확인되지 않은 provider 결과, 중복 source ID를 확인합니다.
4. 운영자 검토 후 JSON 보고서와 마감 manifest를 저장합니다.
5. 정정은 새 adjustment 이벤트나 새 보고서 revision으로 기록하고 기존 이벤트 행은
   수정하지 않습니다.

평가액 합계는 `valuation_currency_code`별로 분리합니다. 서로 다른 단위의 정수 금액을
하나의 합계로 더하지 않습니다. 첫 버전은 의도적으로 읽기 전용입니다. 잔액에서 누락된 과거 이력을 추정하거나,
토스 provider를 호출하거나, 고정된 월별 예산을 강제하지 않습니다. 공식 보고 전에
대상 기간, 평가 기준, 보관 정책은 소비 앱이 토스에 확인해야 합니다.

## 트랜잭션 연결과 마감 명령

`owned_currency::record_event_tx`는 호출자의 트랜잭션에서 기록합니다. 같은 내용의 재시도는
false, 내용 충돌·정책 누락·기간 불일치는 오류이며 원본과 잔액 변경도 함께 롤백해야 합니다.
반환값으로 지급을 승인하지 마세요. 임의 metadata는 받지 않으며 source에는 식별자나 비밀이
아닌 업무 ID만 씁니다. 변환 쌍의 기록은 앱 소유입니다. 예약은 음수 ADJUSTMENT, 성공은 양수
예약 해제 ADJUSTMENT와 음수 EXCHANGE를 동시에 기록합니다. 환급은 ADJUSTMENT이며 ISSUE가 아닙니다.

보고 원장이 아닌 앱 원본에서 다음 비공개 view를 제공합니다.
- owned_currency_expected_events: idempotency_key, user_id(BLOB/NULL), currency_code, unit_code,
  event_type, quantity, source_type, source_id, policy_version, conversion_group_id, exchange_id, occurred_at, valuation_amount, valuation_currency_code.
- owned_currency_expected_balances: user_id, currency_code, unit_code, quantity(스냅샷 현재 잔액).
- owned_currency_reporting_issues: 승인·과거 이력·불확실한 지급 등 미해결 항목당 한 행.
  개별 내용은 내보내지 않습니다.

`reconcileOwnedCurrency({db})`는 집계 수만 반환하고 view가 없으면 실패합니다. 보고 종료 시점의
과거 잔액이 아닌 전체 스냅샷을 대사합니다. 원본 삭제로 보고 기록만 남았다면 운영자 확인이
필요하며 검사를 통과시키려고 원장을 삭제하지 마세요.

`bun packages/trailbase-runtime/bin/owned-currency-close.mjs --db backup.sqlite --config close.json --out 새폴더`
설정: period {start,end}, timestampUnit, timezone, appId, reportRevision, snapshotRef,
approvalRevision(운영자 확인 근거), 선택적 correctionOf. 커밋된 Kit에서 실행합니다.
하나의 읽기 트랜잭션에서 비공개 report.json/report.csv/reconciliation.json을 만듭니다.
품질과 대사가 통과해야 GENERATED manifest를 만들며 검토·승인·제출을 자동 인정하지 않습니다.
차단 시 종료 코드 2와 진단 파일을 남기고 기존 폴더는 덮어쓰지 않습니다. 빈 기간은 별도
운영자 확인이 필요합니다. 앱 view가 실제 정책과 승인 근거를 확인해야 하며 다른 앱의 합산
예산이나 토스 콘솔 승인 상태까지 확인하는 기능은 아닙니다.

문제 view의 occurred_at은 기간별 검사 시각이며, NULL이면 스냅샷 전체에 적용합니다.

마감에는 실제 승인 revision을 반환하는 비공개 owned_currency_close_approvals(revision) view도 필요합니다. 모든 행이 설정의 approvalRevision과 일치해야 하며 빈 근거나 불일치는 manifest를 차단합니다. 서로 다른 승인 revision은 임의 최댓값이 아니라 운영자가 검토한 공통 마감 revision 연결이 필요합니다.

Rust 기록 헬퍼의 시각 단위는 밀리초이며 created_at은 occurred_at과 별도로 DB 시계에서 기록합니다. 정책 누락·기간 불일치는 CURRENCY_POLICY_NOT_EFFECTIVE, 원본 키 충돌은 CURRENCY_EVENT_CONFLICT로 구분합니다.

실시간 기록은 평가액 없는 발행 및 고정 비율 이벤트를 허용하지만 MARKET_SNAPSHOT EXCHANGE에는 평가액이 필수입니다. 제공한 평가액의 통화는 정책과 같아야 하며 NONE 정책에서는 거부합니다(CURRENCY_VALUATION_MISMATCH). 원본 키는 최대 256바이트이며 행 ID는 별도 해시입니다. 기존 행 재시도도 유지합니다. 원본 이벤트 뷰에는 conversion_group_id가 필요합니다(해당 없으면 NULL). 선택한 시간 단위에서 생성 시각 이후에 끝나는 기간은 마감하지 않습니다. 모든 산출물을 기록한 후 동일 디렉터리의 원자적 이름 변경으로 매니페스트를 게시합니다.
