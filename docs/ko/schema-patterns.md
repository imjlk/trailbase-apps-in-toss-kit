# TrailBase 스키마 패턴

SQL 스키마는 kit가 아니라 앱의 소유입니다. 이 kit는 템플릿 조각을 제공할 수 있지만, 앱
저장소로 복사된 마이그레이션은 그 앱에서 검토하고 책임져야 합니다.

도입 앱에서 SQL, Record API 노출 범위, TrailBase 마이그레이션 이력을 바꾸기 전에 이 문서를
읽으세요.

## 기준 마이그레이션과 추가 마이그레이션

운영 또는 운영과 비슷한 데이터가 생긴 뒤에는 일반적인 기능 작업을 위해 기준 SQL(baseline
SQL)을 다시 쓰지 마세요. 대신 앞으로만 진행되는 새 마이그레이션을 추가하세요.

비교적 안전한 추가 변경(additive change)은 다음과 같습니다.

- 새 테이블
- 새 인덱스
- 새 뷰
- NULL 허용(nullable) 컬럼
- 호환되는 기본값이 있는 컬럼
- 기존 읽기와 쓰기를 보존하는 backfill

파괴적인 변경(destructive change)이나 기준 마이그레이션 초기화는 사용자의 명시적인 의도와
데이터 호환성에 대한 분명한 결정이 있을 때만 진행하세요.

기존 baseline을 수정하기 전에, 어떤 환경이라도 보존해야 하는 데이터를 가지고 있는지
확인하세요. 답이 yes이거나 확실하지 않다면 새 추가 마이그레이션을 만드세요.

## Record API 접근 제어

마이그레이션이 공개 테이블, 뷰, 구독 대상을 바꾸면 같은 변경에서 `config.textproto`도 함께
업데이트하세요. 공개 Record API는 보통 읽기 또는 구독만 노출하는 편이 안전합니다. 쓰기는
권한 확인과 불변 조건을 담은 WASM 핸들러나 작업을 통해 처리하세요.

`config.textproto`를 바꾼 뒤에는 앱의 운영 검증 또는 ACL 검증을 실행하세요.

TrailBase `_user`를 Record API principal로 사용하세요. 익명 사용자도 첫 앱 세션에서 `_user`
레코드와 TrailBase auth token을 받아야 ACL rule이 `_USER_.id`를 바로 쓸 수 있습니다. 새 작업에
앱 소유 `users` auth 테이블을 추가하지 마세요. 이미 있다면 제거 대상으로 보고, 제품 필드는
`_user` 기준 `profiles` 또는 도메인 테이블로 옮긴 뒤 참조를 전환하고 데이터 보존 결정이
명확해졌을 때 기존 테이블을 drop합니다.

공개 사용자 데이터는 `_user`에 두지 마세요. 표시 이름, 앱별 아바타, 캐릭터 선택, 제품
도메인 필드는 `_user(id)`를 key로 하는 `profiles`, `profile_view`, 앱별 도메인 테이블에
저장합니다. TrailBase `_user_avatar`는 auth avatar 업로드용이며, 앱별 avatar selection의
유일한 저장소로 쓰지 않습니다. kit의 최소 `profiles` 템플릿은 필수는 아니지만 권장됩니다.
`anonymous_hash_hmac`과 `auth_state`를 앱 profile row 옆에 두어 `_user.verified`에 제품 의미를
덧씌우지 않게 합니다.

Toss identity 충돌로 기존 Toss-linked `_user`가 canonical이 되면 기존 anonymous hash를
`anonymous_user_links`에 저장하세요. Bootstrap handler는 이 alias를 먼저 확인한 뒤 canonical
`_user` 기준으로 새 TrailBase auth token을 발급할 수 있습니다.

공개 bootstrap endpoint에는 `anonymous_bootstrap_attempts`와
`enforce_anonymous_bootstrap_attempt_limit_tx`를 이용한 앱 내부 coarse guard를 추가하세요.
이것이 플랫폼 rate limit을 대체하지는 않지만, 반복 호출로 익명 `_user`가 무제한 생성되는
상황을 줄입니다.

## Toss 식별자

앱은 Toss 식별자를 원문 그대로 노출하지 않아야 합니다.

- 조회용 deterministic `toss_user_key_hmac`
- 복호화가 필요한 경우 AES-GCM `toss_user_key_sealed`

원본 Toss user key, HMAC, 암호문(sealed value), 관련 secret은 공개 Record API view, audit
metadata, log, 사용자에게 보이는 응답에 넣지 마세요.

기본 `toss_identities` 형태는 BLOB foreign key로 `_user(id)`를 참조합니다. 도입 앱에 아직
`toss_identities.user_id TEXT REFERENCES users(id)`가 있다면 `_user(id)` 기준으로 옮기세요.
canonical `_user` row를 추가하거나 파생하고, 참조를 다시 연결한 뒤 도입 앱의 데이터 보존
결정이 명확해졌을 때 기존 app-owned auth 테이블을 제거합니다.

## 프로모션 캠페인

프로모션 캠페인 설정은 특정 기능에 묶이지 않는 구조입니다. 미션, 공유, 추천, 시즌 이벤트,
게임 리워드 같은 여러 기능을 같은 형태로 지원할 수 있습니다. 공통
`promotion_campaigns` 테이블은 앱 고유의 자격 판정 및 지급 원장(ledger)과 분리하고, mTLS
프록시를 호출하기 전에 지급 요청 처리기(claim handler)가 중복 실행되지 않게 만드세요.

전체 모델, 기능 키(feature key), 환경 변수 대체값(fallback), 지급 원장 소유권, 지급 요청
멱등성(claim idempotency), 요청 형태, 제공자 오류 신호(provider error signal)는
[promotion-campaigns.md](promotion-campaigns.md)를 참고하세요.

## 템플릿 차이

하위 모듈(submodule)을 업데이트해도 `templates/trailbase`에서 복사해 간 파일은 자동으로
업데이트되지 않습니다. 앱은 로컬 SQL, Compose, 환경 변수, 스모크 테스트 파일을 kit 템플릿과
주기적으로 비교한 뒤, 해당 앱에 필요한 변경만 선택해야 합니다.
