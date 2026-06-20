# IAP 주문 원장

AppsInToss 인앱 결제 처리에는 서로 다른 두 책임이 있습니다.

- mTLS 프록시는 `orderId`와 복호화된 `tossUserKey`로 Toss 주문 상태를 확인합니다.
- 앱 백엔드는 로컬 주문 원장, 상품 지급, 인벤토리/잔액 반영, 복원 흐름, 멱등성을 소유합니다.

TrailBase가 주문/지급 상태를 저장해야 한다면
`templates/trailbase/sql/iap_orders.sql`을 소비 앱 마이그레이션 묶음으로 복사하세요.
이미 자체 `iap_orders` 테이블이 있는 앱은 테이블을 교체하지 말고 forward migration으로 호환
컬럼을 추가합니다.

## 런타임 흐름

1. RN이 AppsInToss IAP `orderId`를 받거나 복원합니다.
2. 앱 백엔드는 인증된 `_user`의 활성 Toss identity를 읽습니다.
3. 백엔드는 사설 프록시의 `/internal/apps-in-toss/iap/order/status`를 호출합니다.
4. `trailbase_guest_common::iap_orders`는 provider 응답을 정규화하고 로컬 `iap_orders` row를
   upsert할 수 있습니다.
5. 정규화된 상태가 `PENDING_GRANT`이면 앱은 상품 지급을 정확히 한 번 적용한 뒤
   `mark_iap_order_granted_tx`를 호출합니다.

공유 helper는 상품 지급 규칙, 로컬 재화 이름, 인벤토리 테이블, 복원 UX, 환불 정책을 알지
않습니다. 이 정책은 소비 앱에 남겨둡니다.

## 안전 메모

- `_user` id와 선택적 `toss_user_key_hmac`만 저장하고, raw Toss `userKey`는 `iap_orders`에
  저장하지 않습니다.
- 이미 `GRANTED`인 주문은 나중의 비환불 상태 조회가 일시적인 provider 상태를 반환해도
  덮어쓰지 않습니다.
- `grant_payload_json`은 앱 내부 지급 메타데이터에만 사용합니다. 원본 provider 응답이나 내부
  지급 payload를 공개 Record API view로 노출하지 마세요.
- 고빈도 analytics와 분리하세요. IAP order/grant row는 기능성 원장이지 analytics sink event가
  아닙니다.
