# IAP 정기구독

RN reference SDK `2.10.10`에는 구독 구매·상태 조회 API가 포함되어 있습니다.
`createAppsInTossIapBridge`는 `purchaseSubscription({ sku, offerId,
processProductGrant })`와 `getSubscriptionInfo({ orderId })`를 제공합니다. 상품 목록의
CONSUMABLE, NON_CONSUMABLE, SUBSCRIPTION 유형과 renewalCycle·offers를 유지합니다.
이전 SDK를 주입해 기존 기능을 계속 사용할 수 있으며 새 API마다 unavailable·unsupported를
구분합니다. 상태 조회의 undefined 응답은 구독 만료가 아니라 미지원입니다.

구독 구매는 기존 지급 timeout·cleanup 흐름을 사용하고 선택적인 subscriptionId를
backend 지급 callback과 구매 결과에 전달합니다. 복구는 기존 pending orders와
completeProductGrant를 사용합니다. Backend 주문 검증과 멱등 지급을 유지하세요.
Client SDK 상태는 화면 표시용이며 서버 혜택을 단독으로 승인하는 근거가 아닙니다.

[공식 구독 가이드](https://developers-apps-in-toss.toss.im/documentation/common/monetization/iap/in-app-subscription)를
참고하세요. 현재 Toss sandbox 앱은 구독 테스트를 지원하지 않습니다. 로컬 adapter·타입·
SQL 테스트와 실제 Toss 앱 검증은 구분해야 합니다.

## 컨슈머 웹훅 수신

`iap_orders.sql` 뒤에 `iap_subscriptions.sql`을 새 컨슈머 migration으로 적용합니다.
검증된 주문별로 비공개 이벤트 수신 원장과 현재 이용권한 projection을 만듭니다. 기존
구매·지급 행은 유지합니다.

Callback은 컨슈머의 공개 backend에서 신뢰할 수 있는 ingress·인증 통제 후 받습니다.
참조 가이드는 서명 검증 알고리즘을 명시하지 않으므로 kit는 이를 임의로 만들거나
인증 없는 route를 노출하지 않습니다. 임의의 공개 요청이나 client의 getSubscriptionInfo
결과로 이용권한 helper를 호출하면 안 됩니다. mTLS proxy는 발신 전용으로 유지합니다.

1. Ingress 검증 후 `iap_subscriptions::parse_subscription_webhook`로 해석합니다.
   callback.registration_verification은 등록 확인만 수행하며 권한을 부여하지 않습니다.
   알 수 없는 이벤트 유형·버전과 잘못된 상태는 거부합니다.
2. subscription.status_changed는 `apply_subscription_event_tx`로 처리하고 commit합니다.
   타입 기반 저장으로 관계없는 원문 필드를 제외합니다. 중복은 무시하고 이전 이벤트가 새
   상태를 덮지 못하게 합니다. 같은 시각에 다른 이벤트가 오면 needs_reconciliation을
   표시하고 현재 snapshot을 덮지 않습니다.
3. UnmappedOrder는 이벤트를 RECEIVED로 남깁니다. 기존 신뢰된 구매 검증 흐름으로 주문의
   소유자·SKU를 연결한 뒤 저장 payload를 SubscriptionStatusEvent로 읽어 재처리합니다.
   Helper는 사용자를 생성하거나 갱신 주문의 소유자를 추측하지 않습니다.
4. `subscription_entitlement_for_user_tx`는 iap_orders를 통해 소유권을 검사합니다.
   `subscription_access_allowed`와 앱의 disabled-user·혜택 규칙을 함께 적용하세요.
   정합성 충돌, 회수·정지·보류·만료 상태, 접근 거부와 만료된 ACTIVE 기간은 거부합니다.

수신·이용권한 테이블은 공개 Record API에 노출하지 마세요. 이용권한은 주문별로 관리합니다.
갱신 주문과 구독·계정의 연결 및 여러 주문의 혜택 집계는 컨슈머가 소유합니다. 오래된 주문의
callback이 관계없는 새 주문을 덮지 않도록 하기 위함입니다. 재화·재고 지급은 현재 접근
권한 projection과 분리합니다.

## 시각과 복구 정책

공식 웹훅 시각에는 timezone이 없습니다. Helper는 provider-local ISO-8601 시각과
소수 초를 검증·정규화해 순서를 비교하며 UTC를 추측하지 않고 offset을 거부합니다.
제공자 시각 변환을 명시적으로 설정하고 subscription_access_allowed에 해당 로컬
시각을 전달하세요.

IN_GRACE_PERIOD는 신뢰된 accessGranted를 사용합니다. 웹훅에는 별도 유예 만료 필드가
없고 유료 기간의 expiresAt은 이미 지났을 수 있습니다. 업데이트가 누락될 수 있는 경우
앱의 웹훅 최신성·정합성 정책도 확인한 뒤 혜택을 허용하세요. 더 새로운 유효 이벤트는
기존 동일 시각 충돌을 해소합니다. 그렇지 않으면 제공자의 권위 있는 상태로 확인해야 하며
ACTIVE·REVOKED 사이에 임의의 우선순위를 정해 충돌을 덮으면 안 됩니다.
