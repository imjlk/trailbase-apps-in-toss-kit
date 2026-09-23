# WebView SDK 3 어댑터

`@trailbase-apps-in-toss-kit/ait-web`은 `@apps-in-toss/web-framework >=3.4.0 <4`용
소스 소비형 WebView 어댑터입니다. SDK 의존성은 소비 앱이 소유하고 kit은 개발용 타입·번들
검증에만 3.4.0을 설치합니다. RN 소비 앱은 계속 `ait-rn`과
`@apps-in-toss/framework` 2.x를 사용합니다.

```ts
import { createAppsInTossWebAdapter } from '@trailbase-apps-in-toss-kit/ait-web';
const ait = createAppsInTossWebAdapter({ appKey: 'my-app' });
const login = await ait.login();
// authorizationCode와 원래 DEFAULT/SANDBOX referrer를 백엔드 로그인 흐름으로 교환합니다.
// SANDBOX를 로컬 stub으로 취급하지 않습니다.
```

Factory는 현재 `TossAuth`, `User`, `Storage`, `Notification`, `IAP`, `Share` namespace를
필요할 때 로드합니다. Import나 객체 생성만으로 SDK를 로드하지 않습니다. `isSupported()`가
있는 메서드는 네이티브 호출 전에 검사하며 누락·미지원은 `WebAdapterError`로 거절합니다.
SDK 오류는 원본 응답·오류 데이터 없는 제어된 코드로 전달합니다. 브라우저 자동 mock이나
운영 fallback은 없으며 테스트에서만 명시적으로 `loadSdk`를 주입할 수 있습니다.

## 세션과 SDK Storage

`ait.storage`는 공통 `KeyValueStorage` 계약을 구현하며 키에 `${appKey}.`를 붙입니다.
`getItem('appSession')`은 `my-app.appSession`을 읽으므로 같은 키의 기존 SDK Storage 값은
유지됩니다. 브라우저 localStorage를 읽거나 복사하지 않습니다. 공통 TrailBase 세션 저장소와
[세션 생명주기](session-lifecycle.md) coordinator를 함께 사용하세요. 앱별 키를 분리하고
계정 변경 시 계정별 캐시를 비우며, 저장 세션을 재사용하기 전에 현재 SDK 사용자를
인증합니다. 어댑터 생성 자체가 이전 세션 검증·계정 연결·재할당을 수행하지 않습니다.

`anonymousHash()`는 `User.getAnonymousKey`를 사용하며 `ait:` namespace를 유지하거나
추가합니다. 백엔드는 기존 익명 식별 프록시 경계로 값을 검증해야 합니다. 개발 식별자를
만들어 대체하지 않습니다. `login()`은 서버의 실제 교환에 필요한 SDK 일회성 결과를 유지합니다.

## 동의와 결제

`requestNotificationAgreement(templateCode)`는 SDK 결과와 `OPTED_IN`/`OPTED_OUT`,
`source: 'apps_in_toss_sdk'`, `templateCode`/`template_code`를 반환합니다. 거절을 동의로
처리하지 않습니다. 미래 알림 발송 전에 실제 기능성 템플릿 동의를 백엔드에 저장해야 하며,
프록시는 동의를 얻지 않습니다.

```ts
const result = await ait.purchase({
  sku: 'coin-pack',
  processProductGrant: async ({ orderId }) => {
    // 서버에서 소유자·SKU·제공사 상태를 검증하고 정확히 한 번 지급합니다.
    return (await backend.verifyAndGrant(orderId)).granted === true;
  },
});
```

`subscribe`는 같은 필수 백엔드 callback과 `offerId`를 받으며 전달된 `subscriptionId`도
callback에 유지합니다. 정확히 `true`인 결과만 승인하고 throw/reject는 false로 전달합니다.
SDK 성공 이벤트는 UI 결과이며 결제·권한의 서버 증명이 아닙니다. 비공개 IAP 검증 원장이
최종 판단 기준입니다. 이벤트 API는 동기 callback과 timeout에서도 한 번만 정리합니다.
기본 이벤트 제한 시간은 120초이고 최대 10분까지 설정할 수 있습니다. Timeout이나
리스너 종료는 이미 생성·결제된 주문이나 진행 중인 서버 지급을 취소하지 않습니다.
새 결제 전에 원래 주문 ID를 대사하세요.

`getPendingOrders`, `getProducts`, `getSubscriptionInfo`, `completeProductGrant`는 미래
상태와 false 완료 응답을 포함해 SDK 결과를 유지합니다. 서버의 영속 지급 후에만 완료를
알립니다. 기존 IAP 복구 계약으로 미확인·대기 주문을 처리하고, 구독 조회만으로 권한을
지급하지 않습니다. 응답을 잃었다고 새 거래 식별자를 발급하지 않습니다.

`createShareLink`는 `intoss://` 경로를 받고 `share`는 공유 시트를 엽니다. 공유 시트가
종료된 것은 공유 증거가 아니며 보상을 지급하지 않습니다. 광고 등 지원되는 다른
기능은 공식 SDK 3 API를 사용하고, 앱 자체 재화만 명시적 서버 정책과 함께
[서버 보상 시도](app-rewards.md)에 연결하세요. 기존 `contactsViral` 리워드 연동은
종료됐습니다. 이 어댑터가 모든 SDK 기능을 감싸지는 않습니다.

## 소비 앱 전환과 검증

설정 파일 `apps-in-toss.config.ts`, 빌드 명령, Devtools는
[공식 SDK 3 전환 가이드](https://developers-apps-in-toss.toss.im/documentation/integration/sdk-3.x)를
따릅니다. 현재 가이드는 직접 사용한 localStorage 데이터를 유지해야 한다면 전환을
보류하도록 안내합니다. Kit은 origin 저장소를 자동 변환하지 않습니다. 가이드에 따르면
SDK 3 번들 출시 후에는 SDK 2로 롤백할 수 없습니다.

CORS는 실제 콘솔 번들의 origin으로 확인하세요. 2026년 8월 25일 날짜가 있는
[출시·테스트 안내](https://developers-apps-in-toss.toss.im/guide/operation/toss)는 새 SDK 3 업로드에
`apps.tossmini.com`/`private-apps.tossmini.com`을 사용하지만 일반 전환 가이드에는 아직
`web`/`private-web`이 기재돼 있습니다. 현재 콘솔 공지와 앱별 명시적 origin을 적용하고
와일드카드 허용이나 RN origin 변경을 가정하지 않습니다. Kit은 소비 앱 CORS를 변경하지 않습니다.

`bun test packages/ait-web`, 두 `packages:typecheck` 명령과 브라우저 번들을 실행합니다.
명시적 SDK fixture로 정리, 미지원 메서드, 지급 실패, sandbox 로그인 유지, 식별자
정규화와 false·대기 결과를 검증합니다. 브라우저 컴파일은 RN 런타임을 import하지 않는지
검증하며 실기기 로그인·결제·알림·광고 자격을 보장하지는 않습니다. 소비 앱 배포 전 콘솔
QR·기기 검사를 진행하세요.

로그인은 DEFAULT/SANDBOX 외의 미래 문자열 referrer도 유지합니다. 결제 결과는 유효한 원래 주문 ID를 요구하며 order_id 호환 별칭과 다른 네이티브 메타데이터도 유지합니다. SDK 정리 함수가 없으면 이를 허용하고, 제공된 함수는 한 번만 호출합니다.

결제·구독 완료는 도착 순서와 무관하게 같은 주문의 유효한 성공 이벤트와 서버 지급 true를 모두 기다립니다. 같은 주문의 중복 네이티브 지급 callback은 진행 중 결과를 공유합니다. Timeout 후 새로 도착한 지급 callback은 실행하지 않으며 이미 시작한 서버 작업은 대사가 필요합니다.
