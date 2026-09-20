# AIT 계약 롤아웃 및 검증 기록

이 문서는 이 kit의 현재 Apps in Toss 계약 기준선, 컨슈머 앱이 따라야 할 롤아웃
순서, 그리고 기준선 뒤의 검증 근거를 기록합니다. 버전은 서로 다른 릴리즈
열차입니다. 숫자가 같아 보여도 같은 릴리즈를 뜻하지 않습니다.

## 버전 매트릭스

0.5.0 기준선(2026-09-17)이 메시지 UNKNOWN과 3단계 프로모션 기반을
마련했고, 현재 주기는 아래의 **프로모션 v2 breaking 릴리즈**입니다. 컨슈머
이미지는 배포하는 릴리즈의 정확한 태그로 고정하세요 — 같아 보이는 버전
숫자가 같은 릴리즈 열차라고 가정하지 마세요.

| 구성 요소 | 버전 | 비고 |
|---|---|---|
| 프록시 이미지 | `toss-mtls-client-proxy:0.6.2` | 게시된 프로모션 v2 기준선. 아래의 버전 표기된 프로모션 capability 세 가지 필수 |
| 프록시 내부 `@ait-kit/api-core` / `api-client` | `0.5.0` (정확한 고정) | 메시지 UNKNOWN 분류, IAP 엄격 근거, typed 전송 실패 |
| RN/Web `@ait-kit/sdk` | `0.3.0` (정확한 고정) | `ait-rn` 0.6.0 / `ait-web` 0.3.0 (비공개, Sampo 버전 관리) |
| RN 최소 `@apps-in-toss/framework` | `>=2.10.10` | SDK 0.3.0 peer 하한. 최소 fixture도 같은 검토 pin으로 컴파일 |
| WebView `@apps-in-toss/web-framework` | `>=3.4.0 <4` | 변경 없음 |
| Rust guest 크레이트 | `trailbase-guest-common` / `trailbase-toss-identity` 0.12.2 | 고정 묶음. 함께 이동 |
| SQL 템플릿 | 추가 전용 v2 마이그레이션 필수 | 기존 v1 원장에 `promotion_reward_ledger.v2.sql` 적용. 레거시 행 보존 |

## 롤아웃 순서

기존 v1 원장은 새 guest 실행 전에 추가 전용 v2 마이그레이션이 필요합니다.
정산·마이그레이션·배포가 끝날 때까지 발송 중지를 유지합니다:

1. **먼저 발송 중지**: 새 프로모션·메시지 작업 claim을 멈추고 진행 중
   attempt가 끝나게 합니다(메시지 lease는 스스로 만료됩니다). 구 Rust
   guest는 새 프록시의 `UNKNOWN` 응답을 확정 실패로 바꾸므로, 프록시
   롤아웃이 살아 있는 큐 트래픽과 겹쳐서는 안 됩니다. 프록시나 guest를
   교체하기 전에 기존 스택에서 모든 레거시 프로모션 행을 정산합니다.
   저장된 키는 status로 조회하고, 키가 없으면 제공자·운영자가 명시적으로
   정산합니다. PREPARED 재실행이나 대체 키 발급으로 소진하지 마세요.
2. **프록시 다음**(프로모션 v2 breaking): 컨슈머 소유 Compose 이미지 핀을
   릴리즈된 프록시로 올리고(템플릿도 같이 갱신, 최종 태그는 릴리즈에서
   확정 — 이번 주기는 프로모션 grant 라우트를 제거합니다) light-on-off와
   함께 프록시를 교체합니다. 로그인, 메시지, IAP, stub 응답의 wire 형태는
   변경되지 않지만 `promotion/reward/grant`는 업스트림을 건드리지 않고 `410
   PROMOTION_GRANT_REMOVED`로 응답하고, prepare는 수신자를 정확히 하나
   요구하며, status는 관찰된 판정을 그대로 전달합니다(UNKNOWN 유지, PENDING
   재매핑 없음). 발송이 멈춘 워커는 프록시가 먼저 교체돼도 안전합니다.
3. **guest 배포 전에 프록시 preflight**: health 메타데이터 검사에 릴리즈된
   `minimumVersion`과 필수 capability `promotion.prepare.v2`,
   `promotion.execute.v2`, `promotion.status.v2`, `contractVersion: 1`을
   지정합니다([Release Doctor](release-doctor.md#프록시-지원-기능-사전-점검)).
   버전 표기가 중요합니다. v2 이전 프록시는 버전 없는 프로모션 capability를
   광고하고(프록시 0.4.0은 api-core 0.4.2의 UNKNOWN 메시지·IAP 엄격 근거
   동작조차 없는 채로), 오래된 배포는 이 계약으로 통과하는 대신 preflight에
   실패해야 합니다.
4. **레거시 프로모션 드레인 확인 → 원장 스키마 마이그레이션 → 핸들러 전환과 함께
   Rust/WASM guest 배포**: 1단계에서 레거시 프로모션 원장을 정산했는지
   확인합니다 — 모든 레거시 행(키 유무와 PREPARED 포함)을 status
   조회 또는 명시적 정산으로만 마무리합니다(마이그레이션은 이들을 표시 없이
   남기고 v2는 채택하지 않으므로, 드레인하지 않은 지급은 방치됩니다). 그다음
   `templates/trailbase/sql/promotion_reward_ledger.v2.sql`을 명시적
   마이그레이션으로 적용하고(추가 전용 `protocol`/`execution_started_at`
   컬럼, 레거시 행은 표시 없이 보존), 이번 주기 크레이트로 guest를 다시
   빌드하며 **동시에** 앱의 지급 핸들러를 3단계 헬퍼 순서 — pending 원장 행
   삽입(자체 커밋) → 수신자 하나로 prepare → 거래 키 저장(자체 커밋) →
   `execution_started_at` 기록으로 실행 클레임(자체 커밋) → execute → 반영/
   status 복구 — 로 전환합니다. 재빌드만으로는 아무것도 바뀌지 않고 legacy
   grant 헬퍼는 더 컴파일되지 않으므로, 이를 호출하는 핸들러는 이번 주기에
   다시 작성해야 합니다. guest 배포가 메시지 UNKNOWN의 outbox 원장 격리도
   활성화합니다. 프록시 배포 후 빠르게 이어서 배포하고, guest가 살아날 때까지
   발송 중지를 유지하세요.
5. **클라이언트 앱 마지막**: `ait-rn` 0.6.0 / `ait-web` 0.3.0
   (`@ait-kit/sdk` 0.3.0)로 다시 빌드합니다. RN 컨슈머는 이미
   `@apps-in-toss/framework >=2.10.10`이어야 합니다.
6. **재개 및 관찰**: 발송 기능을 다시 켜고 원장 결과를 관찰합니다. 진행
   중이던 프로모션 attempt와 메시지 outbox 행은 그대로 유지됩니다. 격리된
   행의 정산은 기능마다 다릅니다. `execution_started_at`이 기록되고 결과가
   확정되지 않은(pending — PENDING/SUBMITTED/UNKNOWN 제공자 상태 포함)
   three-step 프로모션 행은 `promotion_reward_ledgers_awaiting_recovery_tx`가
   제공하며 저장된 키로 status 조회해 마무리합니다 — status만 호출하고
   prepare/execute는 호출하지 않습니다. 키 없는 레거시 행은 새 키로 재시도하지
   않고 제공자·운영자 정산으로 다룹니다([프로모션
   캠페인](promotion-campaigns.md) 참고). 메시지 UNKNOWN 행도 kit에 status
   엔드포인트가 없으므로 의도적인 재enqueue 결정 전에 `provider_request_id`로
   제공자·운영자가 명시적으로 재확인합니다([기능성
   메시지](functional-messages.md) 참고). UNKNOWN 격리 데이터를 지워서
   "초기화"하지 말고 조회해 마무리하세요.

### 롤백

- 코드 롤백으로 제공자가 이미 실행한 지급을 취소할 수 없습니다.
- v2 마이그레이션은 컬럼을 추가하며 자동 down 마이그레이션은 없습니다.
  롤백해도 컬럼과 실행 사실을 보존하세요. 새 기준선이 기록한
  원장/outbox 데이터는 이전 코드에서도 읽히지만, 구 Rust 파서는
  `provider_status = 'UNKNOWN'` 행을 단순 실패로 읽습니다. 추가 정산 전에
  새 guest를 다시 적용하세요.
- 되돌리기 전에 새 guest가 살아 있는 동안 프로모션 작업을 모두 소진·정산
  하세요. 이전 guest는 저장된 거래 키를 이어서 처리할 수 없습니다.
  - v2 행(`protocol = 'three-step'`) 중 저장된 키가 있고 `execution_started_at IS NULL`인 행(키 저장 후 실행
    시작 전 — 예: 키 커밋 직후 발송 중지)은 지금 클레임하고 실행해
    마무리해야 합니다.
  - `execution_started_at`이 기록되고 결과가 확정되지 않은 행은 저장된 키로
    status 조회해 정산합니다.
  - 키 없는 레거시 행은 status 엔드포인트를 쓸 수 없으므로 제공자·운영자
    정산으로 다룹니다.
  프로모션 실행은 스스로 만료되지 않습니다(만료되는 것은 메시지 lease뿐).
  기다리면 응답을 잃은 execute가 무기한 진행 상태로 남고, 되돌린 뒤에는
  정산 안 된 행이 구 파서에게 실패로 노출됩니다.
- 롤백 시에는 먼저 신규 발송을 멈추고, 위의 프로모션 정산을 마친 뒤(메시지
  attempt는 lease 만료에 맡길 수 있습니다) 프록시와 guest를 함께 되돌립니다.

## 컨슈머 영향 요약

- 프로모션 Rust API·원장·프록시 계약은 breaking 변경입니다. Smart Message 응답
  계약은 추가로 확장됩니다. 프록시 응답을 원본 JSON으로 소비하는 곳은 이제
  메시지 응답에서(5xx, 빈/HTML body, 상충하는 상태)`providerStatus:
  "UNKNOWN"`과 `error: "INVALID_RESPONSE"` 마커를 받을 수 있습니다. 열거형
  status를 전수 검사하는 검증기는 새 값을 허용해야 하고, 모든 소비자는 이를
  실패가 아니라 결과 미확정으로 다뤄야 합니다.
- 프로모션 지급은 breaking 변경입니다. grant 라우트는 업스트림 호출 없이
  `410`으로 응답하고, prepare는 수신자에 바인딩되며, execute는 저장된 키가
  필수이고, status는 관찰된 판정을 그대로 전달합니다(`GRANTED`/`PENDING`/
  `FAILED`/`NOT_FOUND`/`UNKNOWN`, 관찰 시각 `checkedAt`, 조작된 `grantedAt`
  없음). 원본 JSON 프로모션 소비자는 `NOT_FOUND`와 재매핑되지 않은 `UNKNOWN`
  상태를 다뤄야 하고, 원장은 명시적 v2 마이그레이션이 필요합니다(추가 전용
  컬럼, 레거시 행은 표시 없이 보존).
- 이 기준선 어디에도 자동 재발송과 자동 재지급이 없습니다. 결과 미확정
  메시지는 발송 큐에서 제외된 채 유지되고, 미확정/접수된 프로모션은
  pending을 유지하며, 모든 복구는 명시적 결정입니다 — 거래 키를 저장한
  프로모션은 status 조회, 키가 없는 프로모션과 메시지는 request id 기반
  제공자·운영자 정산입니다(이 kit는 Smart Message status 엔드포인트를
  제공하지 않습니다).

## 이전 검증 기록: proxy 0.5.0 (2026-09-17)

아래 기록은 이전 기준선이며 프로모션 v2 검증 결과가 아닙니다. 현재 기준선은
proxy 0.6.2과 Rust 크레이트 0.12.2(릴리즈 PR #145)입니다. v2 마이그레이션과
버전 표기된 capability는 별도로 검증해야 합니다.

로컬 검사는 기능 범위 `ced5f86..08ae12f`(PR #133, #134, #138 — 이 기준선의
모든 소스 변경)에서 실행했습니다. 릴리즈 머지 `729dac6`는 버전 bump,
changelog, lockfile 동기화만 추가하며, 머지 후 main 워크플로우 전체가
성공했습니다. CI 행은 해당 PR, 릴리즈 PR #135, 릴리즈 후 main 실행 결과입니다.

| 검사 | 실행 위치 | 결과 |
|---|---|---|
| `bun run packages:typecheck` / `:minimum` | 로컬 | 통과 (최소 fixture `2.10.10`) |
| `bun run packages:test` | 로컬 + CI "Test JS packages" | 통과 (343 테스트) |
| `bun test services/toss-mtls-client-proxy` | 로컬 + CI "Test proxy" | 통과 (82 테스트) |
| `cargo fmt --all --check` / `clippy -D warnings` / `test --workspace` | 로컬 + CI "Test Rust helpers" | 통과 (lib 165 + 통합 17 테스트) |
| `cargo check --workspace --target wasm32-wasip2` | 로컬 + CI | 통과 |
| `bun run trailbase:wasm:smoke` | 로컬 + CI "Run TrailBase WASM integration smoke" | 통과 |
| `bun run trailbase:functional-ledgers:smoke` | 로컬 | 통과 |
| 이미지 빌드/푸시 | 릴리즈 머지 후 CI "Build and publish image" | 태그 `0.5.0`/`0.5`/`0`/`latest`/`edge`/`sha-729dac6` 푸시 |
| health/capability 메타데이터 | 프록시 스위트 | `promotion.prepare`/`execute`/`status`, `contractVersion: 1` |

검증 경계: 메시지/프로모션/IAP 검증은 모두 로컬 mock 업스트림, 인메모리
SQLite, 공유 wire fixture를 사용했습니다. 실제 Toss API 호출, 실제 토스
앱, CI 빌드를 넘어선 게시본 설치 검사는 없습니다.

## 남은 실기 검사 (컨슈머 소유)

- 배포된 릴리즈 프록시와 일치하는 guest 크레이트 환경에서 실제 토스 앱
  로그인(프로덕션 및 SANDBOX referrer).
- 실제 IAP 구매와 대기 주문 복구. 제공자 SKU 근거에 대한 서버 지급 게이트
  확인.
- prepare → 키 저장 → execute로 이어지는 실제 프로모션 지급과, 응답 유실
  후 status 복구.
- 부분 발송 결과를 포함한 실제 Smart Message 발송과
  `@apps-in-toss/framework` 2.10.10에서의 알림 동의 흐름.
- 컨슈머 자체 지원 버전 정책을 올리기 전에 이 kit 버전 기준으로 Compose
  핀과 복사한 템플릿 정합성 확인.
