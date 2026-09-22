# @ait-kit/sdk로의 SDK 연동 위임

`ait-rn`과 `ait-web` 패키지는 이제 공통 Apps in Toss SDK 처리(모듈 획득,
이벤트 settle-once 처리, 마감 예산, cleanup)를 로컬에서 재구현하는 대신
[`@ait-kit/sdk`](https://www.npmjs.com/package/@ait-kit/sdk)에 위임합니다.
TrailBase는 자신이 소유한 부분(공개 API 표면, TrailBase 서버 연동, 세션
부트스트랩, 저장 키 호환성)을 계속 담당합니다.

두 패키지 모두 `@ait-kit/sdk`를 정확한 버전으로 고정합니다(현재 `0.4.0`).
SDK의 peer 하한이 이 kit의 RN 최소 버전을 정의합니다:
`@apps-in-toss/framework >=2.10.10`(SDK pin 채택 시 `>=2.5.0`에서 상향).
WebView 소비자는 `@apps-in-toss/web-framework >=3.4.0 <4`를 유지합니다.

## 위임 대상

| 기능 | RN (`@ait-kit/sdk/rn`) | Web (`@ait-kit/sdk/web`) |
|---|---|---|
| 로그인 (`appLogin`) | 기본 경로 (주입 함수 없을 때) | — (아래 경계 참고) |
| 익명 키 조회 | 기본 경로 (주입 함수 없을 때) | `anonymousHash()` 조회 |
| Storage | `createAppsInTossSdkStorageBridge()` 헬퍼 | `storage.*` 연산 |
| 전면 광고 로드 | 기본 경로 (주입 함수 없을 때) | — (광고는 RN 전용) |
| IAP 결제 + 대기 주문 | 기본 경로 (`IAP` 모듈 미주입 시) | — (아래 경계 참고) |
| 공유 링크 / 공유 시트 | — | `createShareLink` / `share` |
| 리뷰 요청 | `createReactNativeReview()` | `createWebReview()` |
| 직접 프로모션 adapter | `createReactNativePromotion()` | `createWebPromotion()` |

"기본 경로"는 대체 함수나 모듈을 주입하지 않은 프로덕션 흐름입니다. 주입
seam(`appLogin`, `getAnonymousKey`, `loadFullScreenAd`, `IAP` 등)은 로컬
흐름을 유지합니다. 주입 seam은 동기 등록과 정밀한 오류 분류가 이 패키지의
공개 계약인 테스트/대체 지점이고, 공유 어댑터는 항상 자체 비동기 로더를
거치기 때문입니다.

SDK 0.4.0에는 리뷰와 직접 프로모션 adapter 계약이 추가되었습니다. 이 기능은
명시적으로 선택해야 하며 `ait-rn`과 `ait-web`이 암묵적으로 호출하지 않습니다.
리뷰는 `templates/clients/review-request/`의 controller를 복사해 컨슈머 앱이
호출 시점, cooldown, storage, 화면 상태를 직접 소유하도록 연결하세요. 리뷰
Promise가 끝났다고 리뷰 화면 표시나 작성이 확인되는 것은 아닙니다. 직접 프로모션
adapter도 TrailBase의 3단계 서버 지급 흐름을 대체하거나 자동 fallback하지 않습니다.

## 이 저장소에 남는 것 (그 이유)

- **광고 표시 흐름** — 인터스티셜 완료 추정, 이벤트 타임라인, 타임스탬프는
  공유 어댑터에 없는 TrailBase 정책입니다.
- **IAP 상품 목록 / 구독 조회 / 지급 완료 통지** — 이벤트 흐름 중복이 없는
  단순 promise 호출에 TrailBase 검증이 얹힌 형태입니다.
- **Web 로그인 / 알림 / 결제** — 고정된 TrailBase 계약이 공유 어댑터와
  의도적으로 다릅니다. 로그인은 알 수 없는 미래 `referrer` 문자열을 변경
  없이 백엔드로 통과시키고(어댑터는 열거 밖 referrer를 거절), 알림 동의는
  알 수 없는 이벤트 타입에 즉시 `INVALID_RESULT`로 실패하고(어댑터는 마감
  때까지 대기), 결제 grant 콜백은 테스트가 고정한 정확한 플랫폼 페이로드
  형태를 받습니다.
- **세션 부트스트랩, `ait:` 해시 접두사, 레거시 해시 마이그레이션, 익명
  식별자 변경 시 세션 무효화** — 신원 수명주기는 TrailBase 소유이며, 원시
  SDK 조회만 위임합니다.
- **서버 콜백**(상품 지급 API, 광고 보상 청구, 알림 동의 동기화) — 기존
  콜백과 클라이언트 옵션으로 소비자가 연결하며, 어떤 것도 암묵적으로
  TrailBase 서버를 호출하지 않습니다.

## 소비자에게 보이는 변화 (기본 경로만)

- RN 익명 키 조회가 검증에 실패하면 `ANONYMOUS_KEY_INVALID_RESPONSE`로
  통합 보고됩니다. 로컬 흐름은 `"ERROR"` 센티널(`ANONYMOUS_KEY_ERROR`)과
  잘못된 형태를 구분했지만 공유 어댑터는 둘 다 하나의 invalid-response
  범주로 보고합니다. 주입한 `getAnonymousKey` 함수는 정밀한 분류를
  유지합니다. 오류 코드 union은 그대로이며 `ANONYMOUS_KEY_ERROR`는 여전히
  유효한 값이지만 주입 함수에서만 발생합니다.
- 기본 경로의 RN 결제는 grant 실패를 `IAP_PRODUCT_GRANT_FAILED`로
  보고합니다(공유 어댑터가 grant 결과를 평탄화; 복구 흐름은
  `IAP_PRODUCT_GRANT_TIMEOUT`을 계속 구분). `IAP` 모듈을 주입한 결제는
  변경되지 않습니다.
- Web 공유 결과는 공유 어댑터 계약을 따릅니다. 시트 호출이 resolve되면
  "SDK 공유 호출이 끝났다"는 의미이지(SDK 0.3.0부터 `completed`, 0.2.x는
  `closed`) 보상 승인이 아닙니다. 어댑터는 `failed`가 아닌 resolve를 호출
  완료로만 취급합니다.

## 플랫폼 격리

RN 소스는 `@ait-kit/sdk/rn`(과 런타임 중립 루트의 `SdkError`)만, web
소스는 `@ait-kit/sdk/web`과 루트만 import합니다. 두 공식 SDK 모두
`@ait-kit/sdk`의 **선택적 peer**로 남아 있어 RN 소비자는
`@apps-in-toss/web-framework`를, web 소비자는 RN SDK를 요구하지 않습니다.
두 패키지의 consumer-fixture 테스트가 이를 강제합니다.

## 위임된 기본 경로 테스트

주입 seam 테스트만으로는 위임이 동작한다고 증명되지 않습니다. 두 패키지의
`default-loader` 테스트 파일은 공식 SDK 모듈(`@apps-in-toss/framework` /
`@apps-in-toss/web-framework`)을 mock으로 교체하고 kit을 기본 로더로
구동합니다. RN 로그인, 익명 키, 광고 load(실패 직후 재시도와 load 후 show
포함), IAP 결제/대기 주문 조회(주문 ID 불일치와 중복 grant 콜백 포함),
web identity/저장소/공유 연산을 다룹니다. bun이 mock 모듈 namespace를 첫
import 때 스냅샷하므로, mock은 가변 provider 레코드 위의 안정적 래퍼 함수를
노출합니다. 기능 게이트는 모듈 멤버를 제거하는 대신 호출 시점의
`isSupported` 위임으로 검사합니다.

이 테스트는 kit과 SDK 사이의 연결만 다룹니다. 실제 토스 앱, 네이티브
모듈, 제공자 네트워크를 실행하지 않으므로, 소비자는 자체 지원 SDK 정책을
올리기 전에 실기기 smoke test를 계속 수행해야 합니다.
