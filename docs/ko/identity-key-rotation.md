# 사용자 식별자 암호화 키 교체

`trailbase_toss_identity::TossIdentityKeyRing`은 선택적으로 암호화 키 교체를 지원합니다.
기존 단일 키 함수의 `v1.nonce.ciphertext` 읽기·쓰기는 유지합니다. Key ring은 명시한
legacy 키로만 v1을 읽으며 `v2.keyId.nonce.ciphertext`를 씁니다. AES-GCM의 associated
 data로 버전·키 ID를 인증하며 nonce·암호문 변조도 거절합니다. 알 수 없는 ID에 다른 키를
차례로 대입하지 않습니다. 최대 8개 키 중 하나만 쓰기에 사용하고 평문은 8 KiB, 암호문
봉투는 16 KiB로 제한합니다.

키는 기존 hex/base64 형식의 32바이트 비밀 값입니다. ID는 비밀정보가 아니며 ASCII
영문자·숫자·`_`·`-`로 최대 64자입니다. 같은 ID는 영구적으로 같은 키를 가리켜야 합니다.
소비 앱의 비밀 관리 시스템에서 새 키를 발급하세요. 키·평문·암호문·비공개 cursor를
커밋하지 않습니다. Ring과 배치 진행 정보에는 Debug/Serialize 구현이 없습니다.
이 API가 앱에서 만든 모든 문자열 사본을 메모리에서 자동 소거하는 것은 아닙니다.

## Reader를 먼저 배포하기

1. 기존 키를 v1 legacy 키로 명시한 reader를 먼저 모든 경로에 배포합니다. 로그인,
   익명 수신자, 알림, 오프라인 작업을 포함하며 새 writer 활성화 전에 기존 암호문을 확인합니다.
2. 새 ID로 새 키를 추가하고 활성 writer로 지정합니다. `ring.seal(value)`는 새 WASI 난수
   nonce를 사용합니다. HMAC secret·조회 값·사용자 연결·익명 `ait:` namespace는 유지합니다.
   기존 identity reader에는 `|sealed| ring.unseal(sealed)` closure를 전달할 수 있습니다.
3. 최종 마이그레이션 스캔 전에 v1·이전 키 writer를 중단합니다. 새 v2 값은 기존 단일 키
   함수로 읽을 수 없으므로 코드 롤백도 key-ring reader를 유지해야 합니다. 활성 writer만
   되돌린다고 이미 기록된 v2 행이 사라지지는 않습니다.
4. 제한된 비공개 배치로 재암호화하고, 이전 백업과 보관 중인 철회 기록까지 점검합니다.
   암호문과 필요한 백업이 더 이상 의존하지 않을 때만 키를 폐기합니다. 오류를 없애려고
   키를 삭제하지 않습니다.

```rust,ignore
// 소비 앱 비밀 관리 시스템의 값을 사용하며 소스에 실제 키를 넣지 않습니다.
let ring = trailbase_toss_identity::TossIdentityKeyRing::new(
    "current", &[("legacy", legacy_key.as_str()), ("current", current_key.as_str())],
    Some("legacy"),
)?;
let hmac = trailbase_toss_identity::toss_user_key_hmac(&unchanged_hmac_secret, &user_key)?;
let sealed = ring.seal(&user_key)?;
// 기존 비공개 identity 연결 트랜잭션에서 저장합니다.
```

검증된 익명 식별자의 `ait:` 접두사를 포함해 평문을 유지합니다. 기존 연결·수신자 경계에서
namespace를 검증하세요. 키 교체는 사용자 식별 검증이나 계정 재할당이 아닙니다.

## 재시작 가능한 재암호화 배치

`reseal::reseal_identity_batch_tx`는 복사한 `toss_identities` 또는 `anonymous_identities`
템플릿에 적용합니다. 고정 ID 순서로 최대 100행을 읽고, 활성 키의 행까지 null이 아닌
암호문을 모두 인증한 후 배치를 준비합니다. 변경되는 암호문만 원래 값에 대한
compare-and-swap으로 갱신합니다. HMAC·소유자·철회 상태·업무 timestamp는 바꾸지 않습니다.
Toss 테이블에서 철회 후 암호문이 제거된 행은 건너뜁니다.

```rust,ignore
use trailbase_toss_identity::reseal::{reseal_identity_batch_tx, IdentityCiphertextTable};
let mut tx = trailbase_guest_common::db::tx()?;
let progress = reseal_identity_batch_tx(
    &mut tx, IdentityCiphertextTable::Toss, &ring, saved_cursor.as_deref(), 50,
)?;
// 같은 tx 안에서 progress.next_cursor와 progress.complete를 소비 앱의 비공개 job에
// 저장합니다. 해당 테이블·교체 작업 ID·활성 키에 묶어야 합니다.
// 읽기·인증·CAS·cursor 저장 중 오류가 발생하면 전체 tx를 롤백합니다.
trailbase_guest_common::db::tx_commit(&mut tx)?;
// examined/rewritten 건수만 보고합니다. 익명 cursor 자체가 HMAC 값입니다.
```

호출자가 job cursor와 트랜잭션을 소유합니다. 커밋 전 중단은 이전 암호문과 cursor를 모두
유지해야 하며, 커밋 후 오래된 cursor로 재시도하면 이미 최신 키인 행을 인증만 합니다.
테이블이나 교체 작업 사이에서 cursor를 재사용하지 않습니다. `complete`는 이번 페이지
스캔이 끝났다는 뜻이며, 이전 writer나 동시 insert가 앞쪽 ID의 행을 만들지 않았다는
보장은 아닙니다. 이전 writer를 중단하고 전환 뒤 `None`부터 전체 재검사를 실행한 후,
남은 키별 분포를 확인하고 폐기하세요. 행 ID·암호문·평문·DB 원본 오류를 기록하지 않습니다.

암호문 컬럼의 스키마 변경은 필요하지 않습니다. 영속 job 상태를 추가한다면 소비 앱이
새 비공개 마이그레이션을 소유합니다. WASM을 재빌드하고 전환 동안 호환 reader를 유지합니다.
HMAC 조회 키 교체는 별도의 계정 연결 마이그레이션 계획이 필요하므로 이 API는 HMAC
secret을 받거나 교체하지 않습니다.

검증 범위는 v1/v2 읽기, 활성 키 no-op에서도 인증, HMAC 유지 재암호화, 잘못되거나
누락·폐기된 키, 비정상·과대 입력, 키 바이트가 같아도 키 ID 변조 거절, nonce·암호문 변조,
SQLite CAS 롤백 및 최신 값·조회 값·철회 필드 보존입니다.
