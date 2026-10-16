# 인증된 익명 사용자 식별

공개 WebView bootstrap에서는 SDK 3.6+의 새 인증 코드를 서버에서 교환해야 합니다.
클라이언트가 보낸 익명 hash는 기존 검증 API에서 유효하다고 나와도 호출자의 소유를
증명하지 않습니다. 이전 runtime은 Toss Login 같은 별도 인증 흐름이 필요합니다.
코드 인증 실패 시 hash로 돌아가거나 식별자를 만들어 내면 안 됩니다.

Apps in Toss 익명 사용자는 기존 `ait:<hash>` bootstrap seed를 그대로 사용합니다.
새 서버 검증 helper는 prefix를 뺀 키만 내부 mTLS proxy를 통해
[공식 검증 API](https://developers-apps-in-toss.toss.im/api/user-key)에 전달합니다.
SUCCESS 봉투와 boolean `success: true`를 모두 확인하며 HTTP 200만으로 성공을
판단하지 않습니다. 프록시는 `POST /internal/apps-in-toss/anonymous-key/verify`에서
`{ "anonKey": "..." }`를 받고 검증 상태만 반환합니다. 키와 upstream 오류 원문을
반환하지 않습니다. 명시적인 proxy stub mode는 로컬 테스트용이며 production 검증에는
사용하면 안 됩니다. 이 기존 유효성 확인은 호환성과 수신자 검증용으로 남으며
호출자 인증에 사용하면 안 됩니다.

## Bootstrap 연결

1. 교환·계정 생성 전에 공개 bootstrap endpoint에 rate limit을 적용합니다.
   지원되는 공식 WebView SDK 3.6+ runtime에서
   `createAppsInTossWebAdapter(...).createAnonymousKeyAuthCode()`를 호출하고 `code`를
   즉시 백엔드에 전송합니다. 코드는 5분 뒤 만료되며 한 번만 사용할 수 있습니다.
   캐시·저장·로그에 남기지 마세요.
2. DB transaction 밖에서
   `anonymous_identity::exchange_anonymous_auth_code(proxy_url, token, code)`를 호출합니다.
   실행 중인 프록시의 `anonymous-key.exchange-auth-code` capability와 forward mode를
   요구하세요. 비공개 `POST /internal/apps-in-toss/anonymous-key/exchange`는
   `@ait-kit/api-core` 0.6.0에 교환을 위임합니다. 명시적인 교환 성공 응답만 서버
   식별자로 사용하며 실패·결과 불명 시 `_user`를 인증하지 않습니다. 같은 코드를 자동
   재시도하지 말고 새 명시적 시도에서 코드를 다시 발급받으세요. client hash로 대체하지 마세요.
3. 반환된 `VerifiedAnonymousKey::hmac`에 기존 컨슈머 익명 HMAC secret을 전달합니다.
   기존과 같은 전체 `ait:<hash>` 문자열을 해시합니다. Seed, HMAC key, synthetic email,
   계정 매핑을 바꾸지 않습니다.
4. Canonical `_user` 생성·조회 전에 `anonymous_user_links`를 확인합니다. 앱의 disabled
   principal을 거부하고 `ensure_verified_auth_user_tx`와 기존 공식 TrailBase 로그인·
   비밀번호 회전 helper로 인증 token을 받습니다.
5. `trailbase_toss_identity::seal_verified_anonymous_key`로 암호화합니다. 계정 연결과
   같은 transaction에서 canonical user에 대해
   `anonymous_identity::store_verified_anonymous_identity_tx`를 호출합니다. 소유자가
   다르거나 폐기된 식별자는 거부하며 소유권 이동·폐기 취소를 자동 처리하지 않습니다.

`VerifiedAnonymousKey`와 저장된 recipient type은 의도적으로 Debug·Serialize를
구현하지 않습니다. 익명 키 원문, HMAC, 암호문을 공개 API나 로그에 넣지 마세요.
키 유효성 검증은 프로모션 자격이나 메시지 발송 권한을 뜻하지 않습니다.

교환한 `anonKey`는 기존 SDK anonymous hash와 같으므로 `ait:` HMAC seed와 계정 매핑을
유지합니다. 클라이언트에는 공식 TrailBase 자격 증명만 반환하고 교환 결과 원문은
반환하지 마세요. 컨슈머 소유 bootstrap callback에서 코드를 보내고 세션·계정 전환
guard를 유지해야 합니다. 서브모듈 갱신만으로 공개 endpoint가 자동 전환되지는 않습니다.

공식 계약: [코드 발급](https://developers-apps-in-toss.toss.im/documentation/sdk/domains-api/user/user.createanonymouskeyauthcode),
[서버 교환](https://developers-apps-in-toss.toss.im/api/user-key).

## 추가 migration과 메시지 발송

아래 파일을 순서대로 새 컨슈머 migration에 적용합니다.

- `anonymous_identities.sql`
- `message_outbox_recipients.migration.sql` (기존 outbox 뒤에 한 번 적용)
- `promotion_reward_recipients.sql` (사용한다면 promotion ledger 뒤에 적용)

세 테이블 모두 비공개로 유지합니다. 익명 행을 활성화하기 전에 기존 dispatch worker를
중지하세요. 수신자 migration은 기존 outbox에 `recipient_kind`, `anonymous_hash_hmac`를
추가합니다. 로그인 행의 HMAC·암호문은 그대로 유지합니다. 익명 행은 기존 NOT NULL
`toss_user_key_hmac`에 빈 호환 placeholder를 쓰며, 실제 익명 식별자는 별도 컬럼과
비공개 identity table에 저장합니다. SQL trigger는 혼합 식별자, 누락된 키, 폐기된
식별자, 다른 사용자 연결을 거부합니다. 기존 컬럼을 Toss 로그인 식별자로 해석하는
legacy helper에 익명 행을 전달하지 마세요.

`message_recipients::enqueue_anonymous_message_outbox_tx`로 등록하고
[기능성 메시지](functional-messages.md)의 lease helper로 처리합니다. 발송 허가를
얻기 직전에 두 수신자 유형 모두 `message_recipient_dispatch_gate_tx`를 호출하고
`allowed`를 확인합니다. `_user` 기준의 같은 template·기능성 알림 동의·마케팅 동의
검사를 사용합니다. 앱의 disabled-user·자격 규칙도 별도로 확인해야 합니다.

`message_recipient_for_dispatch_tx`로 현재 유효한 식별자를 조회합니다. 익명 키는
`unseal_anonymous_key`, 로그인 키는 `unseal_toss_user_key`로 복호화하고,
`payload_with_recipient`와 해당 `ProxyRecipient` variant를 사용하세요. Payload에는
`anonKey` 또는 `tossUserKey` 중 하나만 들어가며, 내부 proxy는 익명 메시지에
`x-anon-key`만 보냅니다. 폐기·소유권 변경 시 발송이 중단됩니다. 대기 작업을 다른
canonical user로 옮기는 transaction은 앱이 소유하며 동의를 다시 검사해야 합니다.

## 익명 프로모션과 결과 조회

Proxy의 promotion prepare·execute·status endpoint는 `tossUserKey` 대신 `anonKey`를 받습니다.
둘을 함께 전달하면 거부합니다. 프로모션 v2 계약(api-core 0.5.0)부터 prepare는
수신자에 바인딩됩니다. 수신자를 정확히 하나 받아 키를 발급하고 공식 수신자
헤더를 직접 전송합니다. 프록시는 단계를 오케스트레이션하지 않습니다 —
호출자가 prepare → 키 저장 → 실행 클레임(커밋된 `execution_started_at`
표식) → execute → status를 엔드포인트마다 한 요청씩 수행하며, prepare와
execute 사이에 거래 키를 저장하고 외부 execute 호출 전에 클레임을
커밋해, 이후 충돌하면 행이 조용히 재실행되는 대신 재조회 대상에 남게
합니다. prepare 성공은 키
발급을 뜻할 뿐이고, execute의 `SUBMITTED`는 지급이 아니며, status 조회는
관찰된 판정을 보고합니다(`checkedAt`, 조작된 `grantedAt` 없음). 공유 수신자
상태나 앱 컨테이너의 인증서 접근은 추가하지 않습니다.

기존 `_user` 기준 promotion ledger 행을 만들고 같은 transaction에서
`bind_anonymous_promotion_recipient_tx`를 호출합니다. 반환된 provider 거래키를
저장하세요. 복구 시 `anonymous_promotion_recipient_tx`로 식별자를 읽고 저장된 거래키로
익명 payload를 만든 뒤 `apps_in_toss_proxy::promotion_reward_status_with_payload`를
호출합니다. 이후 Toss 로그인으로 복구 수신자가 바뀌지 않도록 원장에 identity binding을
유지합니다. 키 누락·식별자 폐기 시에는 명시적으로 결과를 확인해야 하며 첫 지급 결과가
불명확하다는 이유로 새 키를 만들면 안 됩니다.

Endpoint를 사용하기 전에 버전 표기된 프로모션 capability(`promotion.prepare.v2`,
`promotion.execute.v2`, `promotion.status.v2`)를 광고하는 프록시를 선택하세요 — 일괄
grant 라우트는 제거되었고 v2 이전 프록시는 이 계약을 노출하지 않습니다. 로컬 계약·SQL
테스트를 제공하지만 rollout 전 컨슈머 앱의 sandbox·실제 앱 bootstrap, 알림 동의,
프로모션 검증은 별도로 필요합니다.

익명 메시지 등록은 기존 로그인 수신자 경로처럼 메시지·템플릿·요청 식별자의 앞뒤
공백을 제거하고, 빈 선택 식별자는 생략된 값으로 처리합니다.
