# 기능 중단·정산·백업 복원 리허설

`templates/trailbase/sql/operation_policies.sql`을 새 비공개 마이그레이션으로 복사하고
WASM guest를 재빌드합니다. `operation_policy::require_operation_tx`는 `iap`,
`promotion`, `smart-message`, `app-reward`를 각각 제어합니다. 행 누락, 만료된 정책,
미래 갱신 시각, 잘못된 flag는 쓰기를 활성화하지 못합니다. 작업을 승인하는 트랜잭션에서
정책을 읽으세요. 클라이언트 UI 상태는 안내용이며 인증·비활성 사용자 차단·도메인 자격
검사는 계속 필요합니다.

| 단계 | 용도 |
| --- | --- |
| `Entry` | 새 결제·보상 시도·메시지 요청 시작 |
| `Dispatch` | 외부 지급·발송·부수 효과가 있는 재시도 승인 |
| `Settlement` | 이미 검증된 결과를 로컬 재화·권한에 반영 |
| `Status` | 읽기 전용 영수증·제공사 상태 조회. 발송·지급 금지 |

신규 진입과 외부 발송을 끄고 정산을 허용하면 이미 검증된 결제를 마무리할 수 있습니다.
복원된 로컬 이력이 불확실하면 정산도 중단하세요. 상태 조회는 정책 행이 없거나 전체
중단 중이어도 가능합니다. 대기 메시지나 프로모션을 재발송할 권한을 뜻하지 않습니다.

```rust,ignore
use trailbase_guest_common::operation_policy::{require_operation_tx, OperationFeature, OperationPhase};
// 기존 메시지 발송 permit 헬퍼와 같은 트랜잭션 안에서 검사합니다.
require_operation_tx(&mut tx, OperationFeature::SmartMessage, OperationPhase::Dispatch)?;
// begin_message_outbox_dispatch_tx(...), 커밋, 이후 발송 순서입니다.
```

기존 멱등 재화 지급 직전에 `Iap/Settlement`, 프로모션 지급 permit 획득 전에
`Promotion/Dispatch`, 앱 자체 보상의 offer/claim 정책 안에서 `AppReward/Entry` 또는
`AppReward/Settlement`를 적용합니다. `SmartMessage/Entry`는 새 outbox 행,
`SmartMessage/Dispatch`는 발송을 차단합니다. 마이그레이션 적용 후
`KIT_OPERATION_POLICIES_ENABLED=1`로 `mark_iap_order_granted_tx`,
`enqueue_message_outbox_tx`, `claim_ready_message_outbox_tx`,
`begin_message_outbox_dispatch_tx`, `insert_promotion_reward_ledger_tx`,
`issue_app_reward_attempt_tx`, `claim_app_reward_attempt_tx`의 내장 검사를
활성화합니다. 이미 지급한 보상의 영수증 재조회는 정산 검사를 건너뜁니다. `operation_policy_integration()`은 설정 상태와 실제 검사되는 헬퍼 목록을
비공개 시작 진단에 제공합니다. 외부 전체 중단은 opt-in flag가 없어도 이 경계에 적용됩니다.
소비 앱이 소유한 SDK 진입·프로모션 직접 발송·사용자 정의 재화 경로에는 명시적 검사가
여전히 필요하며 SQL만으로 모든 경로를 가로채지는 않습니다. `require_operation_tx`는
DB 시각을 내부에서 읽어 오래된 호출자 시각으로 정책을 연장할 수 없습니다.
`OPERATION_HELD`는 외부 전체 중단, `OPERATION_PAUSED`는 정책 누락·만료·비활성화를 뜻합니다. 거절한 트랜잭션은 롤백하고 네트워크
I/O 동안 DB 트랜잭션을 유지하지 않습니다. 중단은 이미 커밋한 permit이나 진행 중인 외부
호출을 취소하지 못합니다. worker를 중단·drain하고 원래 시도를 대사한 뒤 정지 상태로 판정하세요.

운영자는 기대 revision을 비교하고 값을 올리며, 서버 `updated_at`과 의도한 만료 시각을
설정합니다. 변경 행이 정확히 하나인지 확인하세요.

```sql
UPDATE operation_policies
SET revision = revision + 1, allow_entry = 0, allow_dispatch = 0,
    allow_settlement = 1, updated_at = :now, expires_at = :expiry
WHERE feature = 'iap' AND revision = :expected_revision;
```

최초 행도 운영자의 명시적 insert가 필요합니다. 시작 시 자동 활성화하거나 오래된 캐시로
새 revision을 덮어쓰지 않습니다. 운영 감사 기록은 비공개로 유지하고 userKey·HMAC·암호문을
포함하지 않습니다.

## DB 외부의 복원 중단 설정

**모든** API·worker가 복원 DB를 열기 전에 백업 밖 배포 환경에 `KIT_OPERATIONS_HOLD=1`을
설정합니다. `require_operation_tx`의 쓰기 검사는 복원 정책을 읽기 전에 이 값을 우선
적용합니다. `0`, `false`, 미설정은 일반 기능별 정책을 사용하고, 그 외 비어 있지 않은 값은
중단을 유지합니다. 예제 env 파일은 중단 상태가 기본입니다. 오래된 백업에 활성 정책 행이
있어도 시작 시 중단을 우회해서는 안 됩니다. 백그라운드 작업을 포함한 모든 부수 효과
경로에 소비 앱이 검사를 연결해야 합니다.


TrailBase WASM sandbox는 호스트 환경 변수를 자동 상속하지 않습니다. 이 문자열 설정을
별도 읽기 전용 root의 비공개 `/settings.json`으로 렌더링하고 TrailBase에
`--runtime-root-fs /run/kit-runtime`을 전달하세요. 복원 데이터 밖의 root를 사용하고 트래픽
허용 전에 `operation_policy_integration()`의 enabled/held가 의도한 값인지 확인합니다.
`settings.json`은 guest 인스턴스별로 캐시되므로 외부 중단·opt-in 설정 변경 시 모든
API·worker 인스턴스를 재시작합니다. 호스트의 `-e` flag만으로는 충분하지 않습니다.
`templates/trailbase/runtime/operation-settings.example.json`을 참고하세요.

## 과거 백업 리허설과 릴리즈 증거

`trailbase-runtime/restore-checkpoint`는 `evaluateRestoreCheckpoint`와 Release Doctor용
프로그래밍 방식 검사 `createRestoreCheckpointCheck`를 제공합니다. 비공개 DB checkpoint를
**독립적인 영속 write-ahead witness**와 비교하고, 외부 발송 중단 및 진행 중·미해결 작업이
0건으로 보고되었는지 확인합니다. 제공사를 호출하거나 데이터를 쓰거나 작업을 재개하지
않습니다. 통과는 전달받은 증거의 일관성을 확인하며, 앱의 모든 경로에 검사나 외부 이력
기록이 구현되었다는 증명은 아닙니다.

소비 앱이 양쪽 reader와 다음 절차를 소유합니다.

1. 백업 경계 밖에 영속 append-only witness를 둡니다. 외부 효과 **이전**에 원래 요청·거래
   식별자가 포함된 발송 의도를 기록하고, 같은 ID로 대사할 비공개 증거를 보관합니다.
   같은 백업에서 복사한 checkpoint는 독립적인 witness가 아닙니다.
2. 이력 `generation`을 유지하고 안전한 정수 범위의 `sequence`를 단조 증가시키며 진행을
   직렬화합니다. 관련 원장 상태와 함께 DB checkpoint를 커밋합니다. 두 저장소 사이의
   중단은 감지 가능한 차이로 남겨야 하며, 검사를 통과하려고 번호·세대를 초기화하지 않습니다.
3. 외부 중단 설정 아래에서 복원 DB를 시작하고 dispatcher를 중단·drain한 뒤 비교합니다.
   witness 누락, 이력 차이, 결과 미확인은 준비 완료를 막습니다. 복원된 PENDING/READY 행도
   이미 외부 효과를 일으켰을 수 있습니다.
4. 불확실한 작업을 격리하고 원래 제공사 ID·거래 키로 결과를 확인한 뒤 로컬 결과와
   checkpoint를 같은 트랜잭션으로 복구합니다. 무조건 재발송하거나 새 제공사 키를 발급하거나
   검사 해제를 위해 미확인 작업을 성공으로 바꾸지 않습니다. 제공사 조회가 없다면 수동
   해결까지 격리를 유지합니다.
5. 신뢰할 수 있는 비공개 reader로 다시 검사합니다. 운영자가 증거를 수용하고 새 기능
   revision을 적용해 명시적으로 재개하기 전까지 전체 중단을 유지합니다.

```js
import { createRestoreCheckpointCheck } from './vendor/trailbase-apps-in-toss-kit/packages/trailbase-runtime/src/restore-checkpoint.mjs';
// runReleaseDoctor({ checks: [...] })에 추가하는 프로그래밍 방식 검사입니다.
const check = createRestoreCheckpointCheck({ readEvidence: readPrivateRestoreEvidence });
// 실제 비공개 원본에서 { database: { generation, sequence }, witness: { generation, sequence },
//   dispatchPaused: true, inFlight: 0, unresolved: 0 }를 반환합니다.
```

`bun test packages/trailbase-runtime/test/restore-checkpoint.test.mjs`로 실행합니다. 합성
발송 전 실제 SQLite 파일을 복사하고 외부 witness·제공사 상태는 별도 SQLite 파일에
영속화합니다. 과거 백업을 다시 열면 두 번째 발송을 막고 원래 ID를 대사하며, 최종 제공사
호출은 한 번으로 유지됩니다. 기능별 정책 테스트 및 앱 자체 백업·worker 절차와 함께
검증하세요. 비공개 ID·로그 대신 가린 결과와 버전·백업 참조만 증거로 보관합니다.

기본 smoke와 `KIT_SMOKE_OPERATIONS_HOLD=1 bun run trailbase:wasm:smoke`를 모두 실행해 실제 WASM의 설정 마운트와 두 모드의 검사를 검증하세요.
