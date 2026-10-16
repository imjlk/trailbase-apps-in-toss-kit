# WebView SDK 3 어댑터

`@trailbase-apps-in-toss-kit/ait-web`은 `@apps-in-toss/web-framework >=3.4.0 <4`용
소스 소비형 WebView 어댑터입니다. SDK 의존성은 소비 앱이 소유하고 kit은 개발용 타입·번들
검증에만 3.4.0을 설치합니다. RN 소비 앱은 계속 `ait-rn`과
`@apps-in-toss/framework` 2.x를 사용합니다.

익명 호출자 인증용 `ait.createAnonymousKeyAuthCode()`는 `@ait-kit/sdk` 0.7.0에
위임하며 runtime의 공식 WebView SDK 3.6+가 필요합니다. 기존 메서드의 peer 하한은
3.4.0으로 유지합니다. 일회용 코드를 즉시 백엔드에 보내고 저장하거나 인증 실패 시
`anonymousHash()`로 대체하지 마세요. 프록시·Rust 교환은
[익명 식별](anonymous-identity.md)을 참고하세요.

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
운영 fallback은 없습니다. 소비 앱은 자체 실제 SDK loader를 주입할 수 있고,
테스트에서는 명시적인 fixture loader를 주입할 수 있습니다.

## 서브모듈 설치와 SDK 소유권

소비 앱 의존성을 설치하기 전에 고정된 서브모듈을 초기화하세요.

```sh
git submodule update --init --recursive
```

Bun으로 소스 패키지를 소비할 때는 사용할 패키지를 소비 앱의 workspace 설정에
추가하세요. `ait-web`의 내부 `workspace:*` peer를 로컬에서 해결하기 위한 설정이며,
`file:` 의존성만으로는 해당 peer가 workspace로 등록되지 않습니다.
예시는 다음과 같습니다. 기존 의존성과 다른 workspace 항목은 유지하세요.

```json
{
  "private": true,
  "workspaces": [
    "vendor/trailbase-apps-in-toss-kit/packages/ait-web",
    "vendor/trailbase-apps-in-toss-kit/packages/trailbase-client"
  ],
  "dependencies": {
    "@apps-in-toss/web-framework": "3.6.0",
    "@trailbase-apps-in-toss-kit/ait-web": "workspace:*",
    "@trailbase-apps-in-toss-kit/trailbase-client": "workspace:*"
  }
}
```

소비 앱 lockfile을 생성·커밋한 뒤에는 frozen install을 사용하세요. Windows 네이티브
소비 앱은 `bun install --linker hoisted`로 격리 저장소의 긴 경로 문제를 피할 수 있습니다.
Kit 자체 의존성은 kit checkout에서 `bun run deps:install`로 설치합니다. 새 checkout마다
검토한 mise 설정을 trust하고 도구를 설치한 뒤 검증하세요.

서브모듈 안에 kit 개발 의존성이 설치돼 있으면 기본 loader가 소비 앱의 새 SDK 대신
kit의 SDK 3.4.0을 찾을 수 있습니다. 코드 인증에 소비 앱 소유 SDK 3.6+를 사용하려면
loader를 소비 앱의 모듈에 두세요.

```ts
import { createAppsInTossWebAdapter } from '@trailbase-apps-in-toss-kit/ait-web';
const ait = createAppsInTossWebAdapter({
  appKey: 'my-app',
  loadSdk: () => import('@apps-in-toss/web-framework'),
});
```

기존 API용 peer 하한은 3.4.0으로 유지합니다. Loader가 구버전 토스 앱에 런타임 지원을
추가하는 것은 아닙니다. 코드 발급이 지원되지 않으면 클라이언트 hash나 가짜 코드로
대체하지 마세요.

## 압축된 소비 앱 흐름 실행

새 Windows 소비 앱에서 Bun 1.4.2의 압축 오류를 재현했습니다. Fixture loader가
`const sdk = await import(...)` 이후 외부 `...sdk`와 내부 `...sdk.User` spread를
함께 쓰면 생성 코드가 정의되지 않은 변수를 참조했고, 어댑터는 제어된 `UNSUPPORTED`
오류를 반환했습니다. 명시적인 SDK 테스트 override에서는 먼저 구조 분해하세요.

```ts
const { User, ...sdk } = await import('@apps-in-toss/web-framework');
return { ...sdk, User: { ...User, createAnonymousKeyAuthCode: issueFixtureCode } };
```

`issueFixtureCode`는 명시적인 합성 테스트 전용입니다. 운영에서는 위의 실제 소비 앱
SDK loader를 사용하세요. 번들 오류를 진단하려고 코드·원본 식별자를 로그에 남기거나
어댑터의 오류 정제 정책을 완화하지 마세요.

`bun test packages/ait-web`은 chunk splitting 유무별로 브라우저용 압축 소비 앱을
빌드하고 생성된 ESM을 실행합니다. 지연 로딩, 매번 새 코드 발급, 공통 namespace 로드,
실패 시 재시도·hash fallback 부재와 제어된 오류를 검증합니다. 이 검사는 실패하는
spread 형태를 잡았지만 컴파일 성공이나 소스 수준 검사만으로는 잡지 못했습니다.
각 소비 앱에서도 세션이 없는 상태의 실제 압축 entrypoint로 첫 로그인을 실행하고,
계정 전환·새로고침·서버 재시작을 검사하세요. 기존 토큰이 bootstrap 오류를 가릴 수
있습니다. 합성 fixture 실행은 네이티브 WebView·실기기 지원이나 실제 인증서·제공자
준비 상태를 증명하지 않습니다.

## 세션과 SDK Storage

`ait.storage`는 공통 `KeyValueStorage` 계약을 구현하며 키에 `${appKey}.`를 붙입니다.
`getItem('appSession')`은 `my-app.appSession`을 읽으므로 같은 키의 기존 SDK Storage 값은
유지됩니다. 브라우저 localStorage를 읽거나 복사하지 않습니다. 공통 TrailBase 세션 저장소와
[세션 생명주기](session-lifecycle.md) coordinator를 함께 사용하세요. 앱별 키를 분리하고
계정 변경 시 계정별 캐시를 비우며, 저장 세션을 재사용하기 전에 현재 SDK 사용자를
인증합니다. 어댑터 생성 자체가 이전 세션 검증·계정 연결·재할당을 수행하지 않습니다.

`anonymousHash()`는 `User.getAnonymousKey`를 사용하며 `ait:` namespace를 유지하거나
추가합니다. 기존 프록시 검증은 키의 유효성만 검사하며 호출자의 소유권을 증명하지 않습니다.
공개 인증에는 위의 새 코드 교환이 필요합니다. 개발 식별자를 만들어 대체하지 않습니다.
`login()`은 서버의 실제 교환에 필요한 SDK 일회성 결과를 유지합니다.

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
따릅니다. 현재 가이드는 SDK 2의 localStorage 데이터를 유지하려면 SDK 3.1.1 이상을
사용하도록 안내합니다. SDK 3.0.0–3.1.0은 다른 origin을 사용했습니다. Kit은 저장소를
복사하거나 자동 변환하지 않으며, SDK 3 번들 출시 후 SDK 2 롤백은 지원되지 않습니다.

CORS는 실제 콘솔 번들의 origin으로 확인하세요.
[출시·테스트 안내](https://developers-apps-in-toss.toss.im/guide/operation/toss)는 SDK 3.1.1 이상과
SDK 1/2에서 `apps.tossmini.com`/`private-apps.tossmini.com`, SDK 3.0.0–3.1.0에서
`web`/`private-web`을 안내합니다. 일반 전환 가이드의 CORS 절은 여전히 이전 주소를
기재하므로 버전별 안내와 실제 관측 origin을 우선합니다. 와일드카드 대신 앱의 명시적
origin을 사용하며 RN에 WebView CORS 검사를 적용하지 않습니다.
[기기 진단 도구](device-diagnostics.md)를 참고하세요.

`bun test packages/ait-web`, 두 `packages:typecheck` 명령과 브라우저 번들을 실행합니다.
명시적 SDK fixture로 정리, 미지원 메서드, 지급 실패, sandbox 로그인 유지, 식별자
정규화와 false·대기 결과를 검증합니다. 브라우저 컴파일은 RN 런타임을 import하지 않는지
검증하며 실기기 로그인·결제·알림·광고 자격을 보장하지는 않습니다. 소비 앱 배포 전 콘솔
QR·기기 검사를 진행하세요.

로그인은 DEFAULT/SANDBOX 외의 미래 문자열 referrer도 유지합니다. 결제 결과는 유효한 원래 주문 ID를 요구하며 order_id 호환 별칭과 다른 네이티브 메타데이터도 유지합니다. SDK 정리 함수가 없으면 이를 허용하고, 제공된 함수는 한 번만 호출합니다.

결제·구독 완료는 도착 순서와 무관하게 같은 주문의 유효한 성공 이벤트와 서버 지급 true를 모두 기다립니다. 같은 주문의 중복 네이티브 지급 callback은 진행 중 결과를 공유합니다. Timeout 후 새로 도착한 지급 callback은 실행하지 않으며 이미 시작한 서버 작업은 대사가 필요합니다.
