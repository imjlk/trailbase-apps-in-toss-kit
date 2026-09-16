# AIT 계약 롤아웃 및 검증 기록

이 문서는 이 kit의 현재 Apps in Toss 계약 기준선, 컨슈머 앱이 따라야 할 롤아웃
순서, 그리고 기준선 뒤의 검증 근거를 기록합니다. 버전은 서로 다른 릴리즈
열차입니다. 숫자가 같아 보여도 같은 릴리즈를 뜻하지 않습니다.

## 버전 매트릭스 (0.5.0 기준선, 2026-09-17)

| 구성 요소 | 버전 | 비고 |
|---|---|---|
| 프록시 이미지 | `toss-mtls-client-proxy:0.5.0` | GHCR 태그 `0.5.0`, `0.5`, `0`, `latest`, `edge`, `sha-729dac6`; digest `sha256:64d31ef5f2671f5e788c45b6ef49cd6d6569a1e4f8ceee149d4b6257b3733148` |
| 프록시 내부 `@ait-kit/api-core` / `api-client` | `0.4.2` (정확한 고정) | 메시지 UNKNOWN 분류, IAP 엄격 근거, typed 전송 실패 |
| RN/Web `@ait-kit/sdk` | `0.3.0` (정확한 고정) | `ait-rn` 0.6.0 / `ait-web` 0.3.0 (비공개, Sampo 버전 관리) |
| RN 최소 `@apps-in-toss/framework` | `>=2.10.10` | SDK 0.3.0 peer 하한. 최소 fixture도 같은 검토 pin으로 컴파일 |
| WebView `@apps-in-toss/web-framework` | `>=3.4.0 <4` | 변경 없음 |
| Rust guest 크레이트 | `trailbase-guest-common` / `trailbase-toss-identity` 0.11.0 | 고정 묶음. 함께 이동 |
| SQL 템플릿 | 이번 주기 변경 없음 | 마이그레이션 불필요. UNKNOWN/실행 단계는 기존 컬럼 재사용 |

## 롤아웃 순서

이 기준선에는 스키마 마이그레이션이 없습니다. 컨슈머 앱 순서:

1. **프록시 먼저**: 컨슈머 소유 Compose 이미지 핀을
   `toss-mtls-client-proxy:0.5.0`으로 올리고 프록시를 배포합니다(템플릿도
   같이 갱신). 기존 워커는 그대로 동작하며 로그인, 프로모션 grant, stub
   응답의 wire 형태는 변경되지 않았습니다.
2. **Rust/WASM guest 다음**: 크레이트 0.11.0으로 guest를 다시 빌드해
   배포합니다. 메시지 UNKNOWN이 outbox 원장에 격리되고 3단계 프로모션
   흐름이 활성화되는 단계입니다. guest를 다시 빌드하기 전의 구 Rust
   파서는 새 프록시의 `providerStatus: "UNKNOWN"`을 확정 실패로 바꾸므로,
   프록시 배포 후 빠르게 이어서 배포하고 그 사이에 프로모션/메시지
   백로그를 처리하지 마세요.
3. **capability 확인**: 프록시 health 메타데이터가 `promotion.prepare`,
   `promotion.execute`, `promotion.status`, `contractVersion: 1`을
   노출하는지 확인합니다([Release Doctor](release-doctor.md#proxy-capability-preflight)).
   prepare/execute capability가 없는 프록시에서 새 원장 흐름을 legacy
   grant로 조용히 우회해서는 안 됩니다.
4. **클라이언트 앱 마지막**: `ait-rn` 0.6.0 / `ait-web` 0.3.0
   (`@ait-kit/sdk` 0.3.0)로 다시 빌드합니다. RN 컨슈머는 이미
   `@apps-in-toss/framework >=2.10.10`이어야 합니다.
5. **재개 및 관찰**: 발송 기능을 다시 켜고 원장 결과를 관찰합니다. 진행
   중이던 프로모션 attempt와 메시지 outbox 행은 그대로 유지되며,
   `provider_status = 'UNKNOWN'`으로 격리된 `FAILED` 행은 저장된 거래
   키/provider request id로 status 조회해 정산합니다. UNKNOWN 격리
   데이터를 지워서 "초기화"하지 말고 조회해 마무리하세요.

### 롤백

- 코드 롤백으로 제공자가 이미 실행한 지급을 취소할 수 없습니다.
- 자동 down 마이그레이션이 없습니다(추가된 것도 없음). 새 기준선이 기록한
  원장/outbox 데이터는 이전 코드에서도 읽히지만, 구 Rust 파서는
  `provider_status = 'UNKNOWN'` 행을 단순 실패로 읽습니다. 추가 정산 전에
  새 guest를 다시 적용하세요.
- 롤백 시에는 먼저 신규 발송을 멈추고, 진행 중 attempt가 끝나거나 만료된
  뒤 프록시와 guest를 함께 되돌립니다.

## 컨슈머 영향 요약

- kit의 import, 옵션, 응답 형태는 변경되지 않았습니다. 프록시 응답을 원본
  JSON으로 소비하는 곳은 이제 메시지 응답에서(5xx, 빈/HTML body, 상충하는
  상태)`providerStatus: "UNKNOWN"`과 `error: "INVALID_RESPONSE"` 마커를
  받을 수 있음을 알아야 하며, 이를 실패가 아니라 결과 미확정으로 다뤄야
  합니다.
- 프로모션 grant/status wire 응답은 기존 형태를 유지하며, 프록시가 레거시
  원장 소비자를 위해 UNKNOWN을 PENDING으로 매핑합니다.
- 이 기준선 어디에도 자동 재발송과 자동 재지급이 없습니다. 결과 미확정
  메시지는 발송 큐에서 제외된 채 유지되고, 미확정/접수된 프로모션은
  pending을 유지하며, 복구는 항상 명시적인 status 조회입니다.

## 검증 기록 (2026-09-17)

아래는 릴리즈된 기준선 커밋 범위(`ced5f86..08ae12f`, 릴리즈 머지 포함)에서
실행했습니다. 로컬 실행은 저장소의 bun/cargo 툴체인을 사용했고, CI 행은
PR #133, #134, #138, 릴리즈 PR #135와 머지 후 main 워크플로우 결과입니다.

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

- 배포된 프록시 0.5.0 + guest 0.11.0 환경에서 실제 토스 앱 로그인(프로덕션
  및 SANDBOX referrer).
- 실제 IAP 구매와 대기 주문 복구. 제공자 SKU 근거에 대한 서버 지급 게이트
  확인.
- prepare → 키 저장 → execute로 이어지는 실제 프로모션 지급과, 응답 유실
  후 status 복구.
- 부분 발송 결과를 포함한 실제 Smart Message 발송과
  `@apps-in-toss/framework` 2.10.10에서의 알림 동의 흐름.
- 컨슈머 자체 지원 버전 정책을 올리기 전에 이 kit 버전 기준으로 Compose
  핀과 복사한 템플릿 정합성 확인.
