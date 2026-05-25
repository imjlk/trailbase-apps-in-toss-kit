# Toss 식별자 저장 패턴

새 앱은 앱 소유 `users` 세션 레코드가 아니라 TrailBase `_user` 레코드에서 시작하는 것을
기본값으로 삼습니다. AppsInToss 익명 hash를 HMAC 처리하고, 서비스 관리용 `_user.email`로
바꾼 뒤 verified `_user`를 upsert합니다. 그 다음 TrailBase 공식 auth flow로 auth, refresh,
CSRF token을 클라이언트에 내려 Record API 접근 제어가 즉시 현재 `_USER_`를 사용할 수 있게
합니다.

앱 소유 `users` 테이블과 `APP_SESSION_SECRET` 토큰으로 세션을 발급하는 기존 방식은 legacy
입니다. 마이그레이션 중에는 보존할 수 있지만, 새 앱 상태는 `_user(id)`를 기준으로
`profiles`, `profile_view`, 앱별 도메인 테이블에 연결하세요.

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

이 credential은 TrailBase 공식 auth flow를 사용하기 위한 것입니다. 서비스 관리 비밀번호를
클라이언트로 보내지 말고, 앱 코드에서 TrailBase JWT 서명이나 `_session` write를 직접
재구현하지 마세요.

Toss Login의 `email` 필드는 이 kit에서 `_user.email`의 source of truth가 아닙니다. null일 수
있고, 암호화되어 있으며, 점유 인증 여부와 scope가 앱마다 다를 수 있습니다. 이후 별도의
검증된 이메일 마이그레이션 정책이 생기기 전까지 합성 이메일을 유지하세요.

## 공개 프로필

공개 프로필 데이터는 `_user` 밖에 두세요. `_user(id)`를 key로 하는 `profiles` 테이블을 만들고
필요하면 안전한 `profile_view`를 Record API에 노출합니다. TrailBase의 `_user_avatar`는 auth
avatar 업로드용입니다. 앱별 캐릭터 선택, 고양이 아바타, 표시용 정체성은 `profiles`나 도메인
테이블에 두세요.

## Toss Login 연결 해제 콜백

AppsInToss는 사용자가 Toss 앱에서 Toss Login 연결을 해제할 때 앱의 공개 콜백(callback) URL을
호출할 수 있습니다. 이 콜백은 앱 백엔드로 들어오는 요청(inbound request)입니다. 외부 Toss
API를 호출하기 위한 외부 연결용(outbound) mTLS 프록시를 거치지 않습니다.

`trailbase-toss-identity` 헬퍼로 다음을 처리하세요.

- 원본 key를 log하지 않고 `userKey` 또는 `user_key` 콜백 본문을 역직렬화(deserialize)합니다.
- Basic Auth header를 console에 설정한 값과 비교합니다.
- `UNLINK`, `WITHDRAWAL_TERMS`, `WITHDRAWAL_TOSS` 같은 unlink referrer를 정규화합니다.
- `toss_user_key_hmac`을 만들기 전에 `userKey` 형식을 검증합니다.

앱별 데이터베이스 업데이트는 도입 앱에 둡니다. 일반적인 처리는
`toss_identities.toss_user_key_hmac`으로 레코드를 찾고, 일치하는 레코드를 `REVOKED`로 바꾸며,
원본 Toss `userKey`를 제외한 audit/event 레코드를 기록하는 것입니다.
