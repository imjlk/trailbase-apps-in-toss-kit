# 비공개 원장 진단

Ledger doctor는 SQLite 스냅샷을 읽고 Toss 호출이나 데이터 쓰기 없이 진단합니다.
표시하는 내용은 제공자의 현재 상태가 아닌 **원장에 저장된** 상태입니다. 문의를 받았을 때
복구 조치를 선택하기 전에 사용하세요. kit의 고정 런타임은 Bun 1.4.2이며 CLI는
[Bun SQLite](https://bun.com/docs/runtime/sqlite)의 읽기 전용 연결, query-only 모드와
일관된 읽기 트랜잭션을 사용합니다.

```bash
bun vendor/trailbase-apps-in-toss-kit/packages/trailbase-runtime/bin/ledger-doctor.mjs \
  --db /private/backups/main.sqlite --kind iap --record-id "$ORDER_ID" \
  --timestamp-unit milliseconds --server-version 0.33.14 --json
```

DB·소비 앱의 백업 절차로 생성한 일관된 SQLite 백업을 사용하세요. 실행 중인 WAL DB에서
main 파일만 복사하면 최근 트랜잭션이 포함됐다고 보장할 수 없습니다. 스냅샷과 접근 권한은
비공개로 유지하세요. 도구는 운영 인증 정보 취득, 백업 가져오기, 테이블 생성, 마이그레이션,
API 호출을 수행하지 않습니다. kit 기본 테이블명을 사용하므로 커스텀 스키마에는 소비 앱
어댑터가 필요합니다.

| 종류 | 저장된 진단 정보 | 다음 확인 예시 |
| --- | --- | --- |
| `iap` | 로컬 지급, 완료 확인, 환불, 저장된 구독 flag | 주문 검증, 기존 지급 완료 확인, 구독 이벤트 정리 |
| `promotion` | 상태와 기존 거래키 존재 여부 | 기존 거래 조회. 키가 없으면 수동 확인 |
| `message` | 수신자 종류, push/inbox 집계, 최근 시도, lease, 동의 정보 | 만료된 미발송 claim 검토 또는 재발송 없이 불명확한 결과 확인 |

메시지 템플릿·동의 테이블은 선택적으로 조회합니다. 없으면 조회 불가로 표시하며 발송을
허가하지 않습니다. 구독 projection도 저장된 사실일 뿐 접근 권한 승인이 아닙니다.
소비 앱이 실제 권한을 읽거나 부작용을 일으킬 때는 기존 소유자 검사, 알림 동의 gate와
원장 helper를 사용해야 합니다.

복사한 소비 앱이 시간 규칙을 소유하므로 단위를 반드시 지정합니다. DB에 맞춰 `seconds`
또는 `milliseconds`를 선택하세요. `observedAt`은 그 단위의 진단 시각입니다. 갱신 시각이
미래이면 clock skew를 표시하고 안전하게 표현할 수 없는 숫자는 생략합니다.
`tool.sourceCommit`은 도구 체크아웃의 커밋이며 `reportedServerVersion`은 운영자가
제공한 값입니다. 서버 버전을 자동 감지하거나 스냅샷 출처를 검증한 결과가 아닙니다.

## 문의용 ID

인증된 백엔드에서 사용자가 소유한 원장 행의 고정 fingerprint를 반환할 수 있습니다.

```rust
use trailbase_guest_common::ledger_diagnostics::{ledger_diagnostic_id, LedgerKind};
let diagnostic_id = ledger_diagnostic_id(LedgerKind::Iap, &owned_order.order_id)?;
// 엔드포인트가 요청자의 소유권을 확인한 뒤에만 diagnostic_id를 반환하세요.
```

JS 백엔드는 `@trailbase-apps-in-toss-kit/trailbase-runtime/ledger-doctor`에서
`createLedgerDiagnosticId`를 가져올 수 있습니다. 형식은 `kitdiag1.<kind>.<sha256>`이며
UTF-8 `kit-ledger-diagnostic-v1\0<kind>\0<record-id>`를 해시합니다. 원장 기본 키는
512바이트 이하의 유효한 UTF-8이어야 하며 주변 공백·제어 문자·BOM을 포함할 수 없습니다.
IAP는 `order_id`, 메시지·프로모션은 원장의 `id`를 사용합니다. Toss user key, HMAC이나
sealed 값을 넘기지 마세요. Fingerprint는 비밀값·인증 토큰·결제 증명이 아닙니다.

운영자는 fingerprint만으로 문의를 조회할 수 있습니다.

```bash
bun vendor/trailbase-apps-in-toss-kit/packages/trailbase-runtime/bin/ledger-doctor.mjs \
  --db /private/backups/main.sqlite --kind message --diagnostic-id "$DIAGNOSTIC_ID" \
  --timestamp-unit milliseconds --scan-limit 10000
```

Fingerprint 조회는 기본 키만 지정한 한도까지 검사합니다. 기본 10,000개, 최대 100,000개입니다.
검사 범위 밖에 결과가 있을 수 있으면 “행 없음” 대신 `DIAGNOSTIC_LOOKUP_LIMIT_REACHED`를
반환합니다. 큰 원장은 권한 있는 직접 record-ID 조회를 사용하거나 소비 앱 소유의 인덱스
매핑을 추가하세요. kit은 진단 ID 매핑 테이블이나 마이그레이션을 요구하지 않습니다.

## 출력과 복구 경계

텍스트·JSON 출력에서 원본 사용자 식별자, 원장 기본 키, 제공자 거래키, payload, HMAC,
sealed 값과 자유 형식 실패 메시지는 제외합니다. 알려진 상태, 시각, 집계, 존재 여부와
fingerprint만 남깁니다. 예상 밖의 provider 상태는 `UNRECOGNIZED`로 표시합니다. 생략된
실패 상세는 보호된 앱 도구에서 조사하고 원본 DB 행을 문의 로그에 복사하지 마세요.

모든 `recoveryPlan`은 실행 불가능한 제안입니다. 예상 상태·갱신 시각과 메시지의 시도 번호를
기록하고 `requiresFreshRead: true`를 표시합니다. 스냅샷은 즉시 오래된 상태가 될 수 있습니다.
실제 실행 전 권한 있는 트랜잭션에서 현재 원장을 다시 읽고 기존 시도·소유자 guard를 거쳐
공유 상태 전이 helper를 사용하세요. CLI에는 `--apply` 모드가 없으며 무조건 재지급,
새 프로모션 거래키 발급, 결과 불명 메시지 재발송 명령을 만들지 않습니다.

종료 코드는 보고서 생성 0, 완전한 조회에서 행이 없으면 1, 잘못된 입력·필수 스키마 미지원·
불완전한 검색·진단 실패는 2입니다. 선택 테이블 누락과 필수 원장 스키마 불일치는 구분합니다.
공개 엔드포인트, 서버 콜백, 스키마 마이그레이션이나 프록시 배포는 추가하지 않습니다.
배포 검증은 [Release Doctor](release-doctor.md), 실제 상태 전이 계약은
[기능성 메시지](functional-messages.md), [IAP 주문](iap-orders.md),
[프로모션 캠페인](promotion-campaigns.md)을 참고하세요.
