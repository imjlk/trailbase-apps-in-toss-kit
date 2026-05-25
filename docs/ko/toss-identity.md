# Toss 식별자 저장 패턴

앱은 익명 `users` 레코드(row)에서 시작합니다. Toss Login은 구매 복원이나 서버 측 Toss API
호출처럼 기능상 필요할 때에만 익명 사용자를 ACTIVE 상태의 `toss_identities` 레코드와
연결합니다.

원본 Toss `userKey` 값은 애플리케이션 테이블, Record API view, audit metadata, log에 저장하지
마세요. 대신 다음 값을 저장합니다.

- `toss_user_key_hmac`: `TOSS_USER_KEY_HMAC_SECRET`으로 만든 deterministic lookup key.
- `toss_user_key_sealed`: `TOSS_USER_KEY_ENC_KEY`로 암호화한 AES-GCM 암호문(sealed value).

`TOSS_USER_KEY_ENC_KEY`는 데이터베이스 암호화의 루트 키(root key)입니다. 반드시 정확히
32 bytes로 디코딩(decode)되어야 합니다. 이 값을 교체하려면 기존 암호문을 다시 암호화하는
별도 마이그레이션을 의도적으로 준비해야 합니다.

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
