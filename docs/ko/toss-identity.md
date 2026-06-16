# Toss 식별자 저장 패턴

앱은 앱 소유 `users` 세션 레코드가 아니라 TrailBase `_user` 레코드에서 시작하는 것을
기본값으로 삼습니다. AppsInToss 익명 hash를 HMAC 처리하고, 서비스 관리용 `_user.email`로
바꾼 뒤 verified `_user`를 upsert합니다. 그 다음 TrailBase 공식 auth flow로 auth, refresh,
CSRF token을 클라이언트에 내려 Record API 접근 제어가 즉시 현재 `_USER_`를 사용할 수 있게
합니다.

앱 소유 `users` auth 테이블을 병렬로 만들거나 `APP_SESSION_SECRET` 앱 세션을 발급하지
마세요. 도입 앱에 이미 그 형태가 있다면 제품에 필요한 데이터만 `_user` 기준 `profiles`,
`profile_view`, 앱별 도메인 테이블로 옮기고, 참조 전환이 끝난 뒤 기존 auth 테이블과 토큰
경로를 제거하세요.

Toss Login이 완료되면 기존 익명 `_user`를 ACTIVE 상태의 `toss_identities` 레코드와
연결합니다. Toss Login 때문에 새 사용자를 만들지 마세요. 같은 Toss identity가 이미 다른
`_user`에 ACTIVE로 연결되어 있다면 그 Toss-linked `_user`를 canonical user로 보고 새
TrailBase token을 발급하세요.

원본 Toss `userKey` 값은 애플리케이션 테이블, Record API view, audit metadata, log에 저장하지
마세요. 대신 다음 값을 저장합니다.

- `toss_user_key_hmac`: `TOSS_USER_KEY_HMAC_SECRET`으로 만든 deterministic lookup key.
- `toss_user_key_sealed`: `TOSS_USER_KEY_ENC_KEY`로 암호화한 AES-GCM 암호문(sealed value).

`TOSS_USER_KEY_ENC_KEY`는 데이터베이스 암호화의 루트 키(root key)입니다. 반드시 정확히
32 bytes로 디코딩(decode)되어야 합니다. 이 값을 교체하려면 기존 암호문을 다시 암호화하는
별도 마이그레이션을 의도적으로 준비해야 합니다.

## 익명 `_user` 부트스트랩

`trailbase-guest-common` 헬퍼로 HMAC 처리된 AppsInToss 익명 hash에서 서비스 관리용
TrailBase credential을 만드세요.

- `anonymous_hash_hmac`: `USER_HASH_HMAC_SECRET`으로 만든 deterministic lookup key.
- 합성 `_user.email`: `anon+...@users.local.invalid` 형태의 안정적인 내부 이메일.
- 서비스 관리 비밀번호: 별도 secret에서 파생한 서버 전용 credential.

합성 이메일은 TrailBase auth identifier이지 연락처가 아닙니다. 이 주소로 메일을 보내거나
사용자에게 표시하지 말고, `_user.verified = true`를 실제 사람 이메일이 검증되었다는 의미로
해석하지 마세요. 이 플래그는 서비스 관리 credential이 TrailBase의 일반 로그인 흐름을 사용할
수 있다는 기술적 표시입니다.

이 credential은 TrailBase 공식 auth flow를 사용하기 위한 것입니다. 서비스 관리 비밀번호를
클라이언트로 보내지 말고, 앱 코드에서 TrailBase JWT 서명이나 `_session` write를 직접
재구현하지 마세요.

`_user` upsert가 commit된 뒤에는 서비스 관리 credential로 TrailBase 공식 auth login endpoint를
호출합니다. `trailbase-guest-common`은 이 handoff를 위해 `login_auth_user`와
`trailbase_auth_tokens_from_response` 헬퍼를 제공합니다. 이 헬퍼는 auth, refresh, CSRF token
응답을 파싱할 뿐 token을 직접 mint하지 않습니다. credential rotation이 필요하면
`TRAILBASE_AUTH_PASSWORD_SECRET_PREVIOUS`와 함께
`login_anonymous_auth_user_with_password_rotation`을 사용하세요. 새 current secret과 previous
secret을 같이 배포하고, 활성 사용자가 재로그인하며 rehash된 뒤 다음 배포에서 previous를
제거합니다.

부트스트랩 엔드포인트는 익명 생성 남용도 방어해야 합니다. 앱 내부의 coarse guard로는
`anonymous_bootstrap_attempts`와 `enforce_anonymous_bootstrap_attempt_limit_tx`를 쓰고,
운영 공개 경로에는 플랫폼 또는 프록시 레벨 rate limit도 추가하세요.

클라이언트에서는 서비스 관리 비밀번호로 `client.login()`을 호출하지 말고, 서버가 반환한
token으로 공식 `trailbase` JavaScript SDK를 초기화하세요. `trailbase-client`는 이를 위해
`toTrailBaseSdkTokens`와 `createTrailBaseClientAuthOptions` 변환 헬퍼를 제공합니다.

Toss Login의 `email` 필드는 이 kit에서 `_user.email`의 source of truth가 아닙니다. null일 수
있고, 암호화되어 있으며, 점유 인증 여부와 scope가 앱마다 다를 수 있습니다. 이후 별도의
검증된 이메일 마이그레이션 정책이 생기기 전까지 합성 이메일을 유지하세요.

## 공개 프로필

공개 프로필 데이터는 `_user` 밖에 두세요. `_user(id)`를 key로 하는 `profiles` 테이블을 만들고
필요하면 안전한 `profile_view`를 Record API에 노출합니다. TrailBase의 `_user_avatar`는 auth
avatar 업로드용입니다. 앱별 캐릭터 선택, 고양이 아바타, 표시용 정체성은 `profiles`나 도메인
테이블에 두세요. 최소 profile 패턴은 `auth_state`를 `_user.verified`와 분리해 추적합니다:
`anonymous`, `toss_linked`, `email_linked`, `disabled`.

Toss Login 중 같은 Toss identity가 이미 다른 `_user`에 연결되어 있으면 그 Toss-linked row를
canonical로 유지하고 `anonymous_user_links`를 기록하세요. 이후 기존 anonymous hash로
bootstrap이 다시 들어오면 버려진 anonymous row를 되살리지 않고 alias를 통해 canonical user의
새 TrailBase token을 반환해야 합니다.

표준 `_user` 기준 `toss_identities` 스키마에서는
`upsert_toss_identity_for_trailbase_user_tx`를 우선 사용하세요. ACTIVE identity 충돌이 나면
기존 Toss-linked `_user`를 canonical로 보존하고 그 canonical user를 반환하므로, 앱은
anonymous alias를 기록하고 canonical user용 token을 반환할 수 있습니다.

## Toss Login 연결 해제 콜백

AppsInToss는 사용자가 Toss 앱에서 Toss Login 연결을 해제할 때 앱의 공개 콜백(callback) URL을
호출할 수 있습니다. 이 콜백은 앱 백엔드로 들어오는 요청(inbound request)입니다. 외부 Toss
API를 호출하기 위한 외부 연결용(outbound) mTLS 프록시를 거치지 않습니다.
백엔드가 service-side remove-by-user-key API를 직접 호출해 연결을 해제해도 이 콜백은 호출되지
않으므로, 그 local revoke 경로는 도입 앱에서 별도로 처리하세요.

`trailbase-guest-common::toss_unlink` 헬퍼로 다음을 처리하세요.

- 원본 key를 log하지 않고 `userKey` 또는 `user_key` 콜백 본문을 역직렬화(deserialize)합니다.
- Basic Auth header를 console에 설정한 값과 비교합니다.
- `UNLINK`, `WITHDRAWAL_TERMS`, `WITHDRAWAL_TOSS` 같은 unlink referrer를 정규화합니다.
- `userKey` 형식을 검증하고 lookup용 `toss_user_key_hmac`을 만듭니다.

앱별 데이터베이스 업데이트는 도입 앱에 둡니다. 일반적인 처리는
`toss_identities.toss_user_key_hmac`으로 레코드를 찾고, 일치하는 레코드를 `REVOKED`로 바꾸며,
원본 Toss `userKey`를 제외한 audit/event 레코드를 기록하는 것입니다.
