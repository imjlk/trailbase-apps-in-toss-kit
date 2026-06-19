# TrailBase 클라이언트 어댑터

`trailbase-client` 패키지는 공식 TrailBase SDK를 대체하지 않습니다. 여러 AppsInToss
React Native 앱에서 반복되는 연결 코드만 모아 둔 얇은 보조 패키지입니다.

인증 상태, token refresh, Record API 접근은 공식 `trailbase` JavaScript SDK를 사용하세요.
kit는 AppsInToss bootstrap endpoint가 반환한 token payload를 정규화하고 SDK가 기대하는
`{ auth_token, refresh_token, csrf_token }` 형태로 바꾸는 헬퍼만 제공합니다.

요청 처리, TrailBase 오류 정리, 익명 사용자 해시 저장, React Native에서의 SSE 연결 코드가
앱마다 반복될 때 사용하세요. 제품별 API 함수와 데이터 모델은 앱 안에 두는 것이 좋습니다.

## 공통 유틸리티

공통 클라이언트 유틸리티는 다음을 제공합니다.

- 기본 URL 정규화
- JSON 요청과 응답 파싱
- 일반 객체 요청 본문의 자동 JSON 직렬화
- TrailBase 오류 정리
- 저장소 어댑터를 통한 익명 사용자 해시 확인
- TrailBase auth token 정규화와 `trailbase` SDK token option 헬퍼
- SSE 파싱
- React Native 런타임을 위한 `XMLHttpRequest` 기반 스트림 헬퍼

`createAnonymousHash()`는 local/dev/test fallback용 helper입니다. 운영 환경의 Apps in Toss
React Native 비게임 앱에서는 production identity seed로 쓰지 말고, mini-app scoped
`getAnonymousKey()` 값을 사용하는 `@trailbase-apps-in-toss-kit/ait-rn` helper를 쓰세요.

도메인별 클라이언트 함수는 앱 패키지에 남기세요. kit는 재사용 가능한 전송 계층과 어댑터
조각만 제공합니다.

## Apps in Toss SDK 호출

Apps in Toss SDK 호출은 mini-app 런타임 안에서 실행되므로 앱이 소유합니다. 사용자가 특정
조건의 향후 알림을 신청하는 기능성 Smart Message 흐름에서는 `@apps-in-toss/framework` 또는
`@apps-in-toss/web-framework`의
`requestNotificationAgreement({ options: { templateCode } })`를 호출한 뒤, 그 결과를 앱
백엔드로 보내 동의 상태를 저장하고 나서 발송하세요.

React Native 앱은 `ait-rn` 알림 helper를 사용하세요. 공식 SDK 함수는 앱에서 import한 뒤
bridge에 주입합니다.

```ts
import {
  requestNotificationAgreement,
} from "@apps-in-toss/framework";
import {
  createAppsInTossFunctionalMessageClient,
  createAppsInTossNotificationAgreementBridge,
} from "@trailbase-apps-in-toss-kit/ait-rn/notifications";

const notifications = createAppsInTossNotificationAgreementBridge({
  requestNotificationAgreement,
});
const messages = createAppsInTossFunctionalMessageClient({
  baseUrl: apiBaseUrl,
  endpoints: {
    requestMessage: "/api/app/v1/messages/request",
    syncAgreement: "/api/app/v1/notification-agreements",
  },
  getAuthHeaders,
});

const agreement = await notifications.requestAgreement({
  templateCode: "ORDER_READY_AGREEMENT",
});

await messages.syncAgreement({
  result: agreement.result,
  templateCode: agreement.templateCode,
});

if (agreement.status === "OPTED_IN") {
  await messages.requestMessage({
    agreementTemplateCode: "ORDER_READY_AGREEMENT",
    context: { orderName: "Sample order" },
    providerRequestId: "order-ready:order-123",
    templateSetCode: "ORDER_READY",
  });
}
```

bridge는 `newAgreement`, `alreadyAgreed`를 `OPTED_IN`으로,
`agreementRejected`를 `OPTED_OUT`으로 바꾸고 SDK cleanup을 한 번만 호출합니다. 운영 환경에서
SDK bridge가 없으면 fail-closed로 실패합니다. `templateCode`는 SDK에 전달하는 알림 동의문
코드입니다. `templateSetCode`는 백엔드/proxy가 사용하는 기능성 메시지 발송 코드입니다.
단순한 1:1 흐름에서는 두 코드가 같을 수 있지만, 여러 발송 템플릿이 하나의 동의문을 공유하는
경우에는 분리해서 관리하세요.
동기화한 동의 상태가 `OPTED_IN`일 때만 기능성 메시지를 enqueue/request하세요.
`OPTED_OUT` 결과는 저장하되 발송하지 않는 것이 맞습니다.

기능성 메시지 client는 앱이 소유한 백엔드 endpoint만 호출합니다. React Native에서 Toss Smart
Message API, mTLS proxy, 인증서 기반 서비스를 직접 호출하지 마세요. 기존
`@trailbase-apps-in-toss-kit/trailbase-client/apps-in-toss`의
`requestAppsInTossNotificationAgreement` helper는 호환을 위해 남아 있지만, 새 React Native
코드에서는 deprecated입니다.

## Apps in Toss 프로모션 claim

RN 코드에서 campaign claim client가 필요하면
`@trailbase-apps-in-toss-kit/ait-rn/promotion`을 사용하세요. 이 client는 앱/백엔드
`campaignId`만 전송합니다. Toss Console promotion code, raw Toss user key, proxy token,
인증서 자료는 받거나 전달하지 않습니다.

```ts
import { createAppsInTossPromotionCampaignClient } from "@trailbase-apps-in-toss-kit/ait-rn/promotion";

const promotions = createAppsInTossPromotionCampaignClient({
  baseUrl: apiBaseUrl,
  claimEndpoint: "/api/app/v1/promotions/claim",
  getAuthHeaders,
});

const claim = await promotions.claim({
  campaignId: "daily-attendance",
  eligibilityId: "attendance-2026-06-19",
  requestId: "daily-attendance:user-123:2026-06-19",
});
```

eligibility, idempotency, budget check, campaign 활성화, Toss promotion code 선택, mTLS proxy
호출은 백엔드가 소유합니다. RN helper는 `GRANTED`, `ALREADY_GRANTED`, `PENDING`, `FAILED`,
`NOT_ELIGIBLE`, `EXHAUSTED` 같은 공통 claim 결과만 정규화합니다.

## Apps in Toss React Native 세션 유틸리티

React Native 비게임 mini-app에서 익명 TrailBase `_user`를 bootstrap할 때는 Apps in Toss
SDK의 `getAnonymousKey()`가 반환한 `{ type: "HASH", hash }` 값을 기준으로 삼으세요.
`@trailbase-apps-in-toss-kit/ait-rn` 패키지는 이 값을 `ait:${hash}` 형태로 정규화하고,
기존 storage에 남아 있던 legacy `anon_...` 값을 운영 환경에서 Apps in Toss key로 교체하는
작은 storage wrapper를 제공합니다.

kit의 표준 key 형태를 쓸 수 있는 앱은 `createAppsInTossSessionStorage({ appKey })`부터
사용하세요. `appKey: "my-app"`이면 `my-app.anonymousHash`, `my-app.appSession`,
`my-app.tossSession`을 만들고, 공식 Apps in Toss `Storage` API와 익명 identity wrapper를
함께 묶습니다. 기존 colon/version key를 유지해야 하는 앱은 storage key migration을 계획하기
전까지 lower-level helper를 계속 쓰면 됩니다.

```ts
import {
  Storage,
  appLogin,
} from "@apps-in-toss/framework";
import {
  createAppsInTossLoginBridge,
  createAppsInTossSessionStorage,
} from "@trailbase-apps-in-toss-kit/ait-rn";
import { createAppsInTossSessionManager } from "@trailbase-apps-in-toss-kit/trailbase-client";

const env = process.env.APP_ENV ?? process.env.NODE_ENV;
const sessionStorage = createAppsInTossSessionStorage({
  appKey: "my-app",
  env,
  storage: Storage,
});
const loginBridge = createAppsInTossLoginBridge({
  appLogin,
  env,
});

// bootstrap, completeTossLogin, loadSession은 앱이 구현한 API callback입니다.
export const sessionManager = createAppsInTossSessionManager({
  storage: sessionStorage.storage,
  anonymousHashStorageKey: sessionStorage.anonymousHashStorageKey,
  appSessionStorageKey: sessionStorage.appSessionStorageKey,
  tossSessionStorageKey: sessionStorage.tossSessionStorageKey,
  ...loginBridge,
  bootstrap,
  completeTossLogin,
  loadSession,
});
```

운영 환경에서 Apps in Toss SDK가 `{ type: "HASH" }` 값을 반환하지 못하면 helper는 랜덤 값을
만들지 않고 `AppsInTossIdentityError`를 던집니다. dev/test에서는 SDK가 없는 로컬 실행을
위해 `dev-anon_...` fallback을 허용할 수 있습니다.
앱 세션 storage key를 커스텀했다면 identity storage wrapper에도 같은 key를 전달하세요.
그래야 저장된 익명 hash를 갱신한 뒤 legacy 익명 세션을 재사용하지 않고 다시 bootstrap합니다.

`createAppsInTossLoginBridge()`는 bridge adapter만 담당합니다. 운영 환경에서 SDK bridge가
없거나 실패하면 fail-closed로 처리하고, dev/test에는 명시적인 fallback authorization code를
제공합니다. `appLogin` 결과 shape 정규화는 공유 `createAppsInTossSessionManager`와
`requestAppsInTossLogin` 경로에 맡깁니다. Apps in Toss의
`getIsTossLoginIntegratedService()` API는 현재 유저가 이미 연동된 유저인지 migration 용도로
확인하는 함수입니다. 따라서 raw migration check는 앱 UX나 데이터 migration 코드에 남기고,
`false` 값을 첫 `appLogin` flow를 막는 sign-in preflight로 쓰지 마세요.

lower-level 세션 영속성이 필요하면 공식 Apps in Toss `Storage` API를 감싸서
`createAppsInTossSessionManager`에 전달하세요. Apps in Toss 문서는 이 네이티브 저장소가 앱
재시작 후에도 유지된다고 안내하며, mini-app 런타임에서 `AsyncStorage` 사용은 피하라고
설명합니다.

```ts
import { Storage } from "@apps-in-toss/framework";
import {
  createAppsInTossKeyValueStorage,
  createAppsInTossSessionManager,
} from "@trailbase-apps-in-toss-kit/trailbase-client/apps-in-toss";

const sessionStorage = createAppsInTossKeyValueStorage({
  storage: Storage,
  env: "production",
});

const sessionManager = createAppsInTossSessionManager({
  storage: sessionStorage,
  appLogin,
  loadSession,
  bootstrap,
  completeTossLogin,
});
```

로컬 테스트에서는 `createMemoryKeyValueStorage()`나 localStorage 기반 adapter를
`fallbackStorage`로 넘길 수 있습니다. 운영 빌드에서는 `Storage`가 없을 때 fallback을 켜지
마세요.

일부 런타임은 `GraniteModule.generateHapticFeedback` 또는
`BedrockModule.generateHapticFeedback`를 노출하지 않아 haptic을 내부에서 호출하는 TDS
컴포넌트가 깨질 수 있습니다. 앱 entrypoint에서 한 번 no-op fallback을 설치하고, React Native
import는 앱에 남기세요.

```ts
import { NativeModules } from "react-native";
import { ensureAppsInTossHapticFallback } from "@trailbase-apps-in-toss-kit/ait-rn";

ensureAppsInTossHapticFallback({ nativeModules: NativeModules });
```

intro 표시 여부, 방문 세션, 카운터처럼 작은 앱 로컬 JSON 상태에는 같은 storage adapter와
`createPersistentJsonAtom()`을 쓰세요. React hook이나 subscription 모델을 추가하지 않고
`read`, `write`, `clear`만 제공합니다.

```ts
import { createPersistentJsonAtom } from "@trailbase-apps-in-toss-kit/ait-rn";

export const introSeenAtom = createPersistentJsonAtom<boolean>({
  fallback: false,
  key: "my-app.introSeen",
  normalize: (value) => (typeof value === "boolean" ? value : null),
  storage: sessionStorage.storage,
});
```

`ait-rn` 패키지는 작은 import를 원하는 앱을 위해 `./identity`, `./storage`, `./login`,
`./haptics`, `./ads`, `./share`, `./notifications`, `./promotion` 하위 경로도 노출합니다.
기존 root import는 같은 public API를 계속 reexport합니다.

Apps in Toss 전면형/보상형 광고에서는 placement 이름, env 변수, 리워드 지급, 서버
idempotency를 앱에 남기세요. kit는 SDK callback API를 `load -> show` Promise 흐름으로
바꾸고, `adGroupId`별 preload 중복 제거와 cleanup만 담당합니다. `auto` 모드에서는 sandbox와
로컬 dev 흐름을 mock 리워드로 처리하고, 앱이 SDK 경로를 의도적으로 검증해야 할 때만
`rewardMode: "live"`와 앱 소유 sandbox/test 광고 ID를 사용하세요.

```ts
import { loadFullScreenAd, showFullScreenAd } from "@apps-in-toss/framework";
import {
  createAppsInTossFullScreenAdBridge,
  shouldUseAppsInTossMockAd,
} from "@trailbase-apps-in-toss-kit/ait-rn/ads";

const ads = createAppsInTossFullScreenAdBridge({
  loadFullScreenAd,
  showFullScreenAd,
});

// sandbox/test 광고 ID는 재사용 kit import graph나 production release bundle이 아니라
// 앱이 소유한 dev 또는 sandbox 설정에만 두세요. 이 값은 rewardMode가 SDK 경로를
// 의도적으로 강제할 때만 사용됩니다.
const adGroupId =
  operationalEnvironment === "sandbox"
    ? env.REWARDED_SANDBOX_AD_GROUP_ID
    : env.REWARDED_AD_GROUP_ID;

if (shouldUseAppsInTossMockAd({ isDev, rewardMode, operationalEnvironment })) {
  await grantLocalMockReward();
} else {
  const result = await ads.preloadAndShow({
    adFormat: "rewarded",
    adGroupId,
    preloadNext: true,
  });
  if (result.earned) {
    await grantRewardOnServer(result);
  }
}
```

Apps in Toss 공유 링크에서는 문구와 OG 이미지 선택을 앱에 남기세요. share bridge는
`intoss://` 링크를 정규화하고, 유효한 OG 이미지 URL을 선택적으로 prewarm한 뒤,
`getTossShareLink()`와 `share()`를 호출하는 얇은 adapter입니다.

```ts
import { getTossShareLink, share } from "@apps-in-toss/framework";
import { createAppsInTossShareBridge } from "@trailbase-apps-in-toss-kit/ait-rn/share";

const shareBridge = createAppsInTossShareBridge({
  getTossShareLink,
  share,
});

const tossLink = await shareBridge.shareLink({
  appName: "my-app",
  message: "토스에서 이번 라운드에 도전해보세요.",
  ogImageUrl: "https://example.com/og/round.png",
  path: "/rounds/current",
});
```

## TanStack DB

TanStack DB 어댑터는 의도적으로 얇게 유지합니다. React Native에서 쓰기 쉬운 SSE 브리지,
스냅샷 로딩, 재연결 훅을 갖춘 TrailBase Record API 컬렉션을 만들도록 돕지만, 테이블 이름,
조회 조건, 레코드 모델은 앱에 남깁니다.

XHR 기반 SSE 구독은 인증이 필요한 Record API를 위해 호출자가 넘긴 헤더를 사용할 수
있습니다. HTTP 실패는 조용히 스트림을 닫지 않고 `TrailBaseHttpError`로 전달합니다.

`./tanstack-db` 하위 경로는 kit에 고정된 `@tanstack/react-db` 버전에 의존합니다. 소비 앱은
서브모듈을 통해 같은 어댑터 표면을 재사용하면 됩니다. `@tanstack/react-query`와 `trailbase`는
쿼리 기본값이나 공식 TrailBase SDK 접근을 선택적으로 도입하는 앱을 위한 peer dependency로
남깁니다. 지원하는 `trailbase` peer 범위는 `0.12.1`부터 시작합니다. 이 버전은
`client.login()`, `client.tokens()`, `client.headers()` 동작을 확인한 현재 SDK 버전입니다.

## TanStack Query

TanStack Query 하위 경로는 작은 기본값과 옵션 헬퍼만 제공합니다. 쿼리 키, stale time,
mutation 동작은 앱이 정해야 하므로 애플리케이션 쿼리를 감싸지 않습니다.

## 도입 방식

각 하위 경로는 독립적으로 도입할 수 있습니다. 요청, 오류, 저장소 헬퍼만 필요하면 공통
유틸리티부터 사용하세요. 공유 쿼리 기본값이 필요해지면 TanStack Query 헬퍼를 더하고,
Record API 스냅샷과 실시간 컬렉션 코드가 반복될 때만 TanStack DB 어댑터를 추가하세요.

이미 안정적인 클라이언트 계층이 있는 앱이라면 반복되는 부분을 하나씩 옮기세요. 기대하는
결과는 애플리케이션 데이터 모델 변경이 아니라 전송 코드 감소입니다.
