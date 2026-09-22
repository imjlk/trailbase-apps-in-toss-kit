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
