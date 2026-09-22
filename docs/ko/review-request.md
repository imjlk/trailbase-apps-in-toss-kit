# 컨슈머 앱의 리뷰 요청

PR-03은 `@ait-kit/sdk@0.4.0`에 게시된 리뷰 adapter를 컨슈머 앱에서 연결할 수
있는 복사형 controller를 제공합니다. Controller는 앱의 호출 시점과 중복 억제를
담당하지만, Apps in Toss API를 다시 구현하지 않고 리뷰 화면이 표시되었거나
작성되었다고 기록하지도 않습니다.

공식 `Review.request()` API의 반환값은 `Promise<void>`입니다. Promise가 resolve된
것은 SDK 호출이 끝났다는 뜻일 뿐입니다. 앱인토스가 리뷰 화면을 표시하지 않을 수도
있으므로 핵심 화면 이동, 보상, 기능 접근을 리뷰 요청에 의존하면 안 됩니다.
[리뷰 요청 가이드](https://developers-apps-in-toss.toss.im/documentation/common/growth/review.md)와
[`Review.request`](https://developers-apps-in-toss.toss.im/documentation/sdk/domains-api/review/review.request.md)를
함께 확인하세요.

## Controller 복사하기

`templates/clients/review-request/review-request-controller.mjs`를 컨슈머 앱으로
복사하고 앱 수명주기에서 하나의 controller를 공유하세요. 같은 storage 객체와
storage key로 factory를 다시 호출하면 같은 controller를 돌려줍니다. 화면 컴포넌트마다
새 controller를 만들지 마세요. 같은 영속 저장소를 새 wrapper 객체로 감싸는 앱은
메모리 세션 lock도 공유할 수 있도록 더 높은 수명주기에 controller를 보관하세요.

주입하는 `getScreenState()`는 다음처럼 boolean 필드를 정확히 반환해야 합니다.

```js
{
  foreground: true,
  blockingOverlay: false,
  contextKey: accountOrSessionKey
}
```

형식이 잘못된 상태는 차단된 화면으로 처리합니다. 계정이나 활성 세션이 바뀌면
`contextKey`도 바꾸세요. 비동기 검사 중 이전 context의 응답이 도착해도 SDK 호출
직전에 폐기됩니다.

## 핵심 행동이 끝난 뒤 연결하기

`@ait-kit/sdk@0.4.0`의 플랫폼 adapter와 앱의 storage·자격 조건을 주입합니다.
RN과 Web은 서로 다른 entry point를 사용합니다.

```js
import { createReactNativeReview } from "@ait-kit/sdk/rn";
import { createReviewRequestController } from "./review-request-controller.mjs";

const reviewController = createReviewRequestController({
  review: createReactNativeReview(),
  storage: {
    get: (key) => appStorage.get(key),
    set: (key, value) => appStorage.set(key, value),
  },
  isEligible: () => completedCoreActionCount >= 1,
  getScreenState: () => ({
    foreground: appState === "active",
    blockingOverlay: isPaymentOrAdOverlayVisible,
    contextKey: activeAccountKey,
  }),
  cooldownMs: 7 * 24 * 60 * 60 * 1000,
  report: (event) => recordReviewRequestEvent(event),
});

async function handleTaskCompleted() {
  await completeAndPersistTask();
  showCompletionScreen();

  // 필수 작업과 완료 화면은 선택 기능인 리뷰 요청을 기다리지 않습니다.
  void reviewController.maybeRequest();
}
```

Web에서는 `@ait-kit/sdk/web`에서 `createWebReview`를 가져옵니다. 예시 cooldown은
앱 설정이며 앱인토스의 제한을 뜻하지 않습니다. Controller는
`review.request()` 호출 전에 시도 기록을 남기고, SDK 성공·실패나 화면 미표시 이후에도
그 기록을 유지합니다. Storage 읽기/쓰기가 실패하면 리뷰 요청만 생략해 핵심 행동에
영향을 주지 않습니다.

Controller가 보고하는 이벤트는 다음뿐입니다.

- `review_request_attempted`: SDK 호출을 시작하기 직전입니다.
- `review_request_skipped`: `cooldown`, `in_flight`, `stale_context`, `unsupported` 같은
  안전한 사유로 호출하지 않았습니다.
- `review_request_failed`: 지원 검사, storage, telemetry, SDK 호출이 실패했습니다. 오류
  원문 대신 오류 코드만 남깁니다.
- `review_request_settled`: SDK Promise가 끝났습니다. 리뷰 결과가 아닙니다.

반환 상태는 `settled`, `failed`, `skipped`입니다. 어느 상태도 사용자가 리뷰를
작성했다는 뜻이 아닙니다. 이 controller에 별점, `shown`, `submitted`, `reviewed`,
보상 자격을 저장하지 마세요.

## 설치된 SDK 호환성 확인

Kit의 metadata 전용 진단기는 package manifest와 실제 resolve된 버전만 읽습니다.
SDK 코드를 import하거나 package를 설치하지 않고 lockfile도 수정하지 않습니다.

```bash
node vendor/trailbase-apps-in-toss-kit/scripts/check-consumer-sdk-compatibility.mjs \
  --root /path/to/consumer-app --runtime rn --json
```

WebView 앱은 `--runtime web`을 사용합니다. 결과에서 `@ait-kit/sdk` peer 범위와
설치된 공식 SDK 버전을 확인할 수 있습니다. Toss 앱 런타임 지원 여부는 항상
`not_checked`로 출력되므로, 지원 SDK 정책을 바꾸기 전에는 앱의 실기기 smoke test를
별도로 실행하세요.

이 controller는 리뷰 요청만 담당합니다. 프로모션 리워드를 지급하거나 리뷰 완료를
추정하지 않으며, 클라이언트 지급과 서버 지급 사이에서 자동 fallback하지 않습니다.
