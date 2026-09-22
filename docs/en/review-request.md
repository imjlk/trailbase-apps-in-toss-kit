# Review requests in consumer apps

PR-03 provides a copyable controller for the review adapters published by
`@ait-kit/sdk@0.4.0`. The controller owns timing and duplicate suppression for
an app. It does not implement the Apps in Toss API and it does not record that a
review was shown, submitted, or written.

The official `Review.request()` API returns `Promise<void>`. A resolved promise
means only that the SDK call settled. Apps in Toss may decide not to show the
review UI, so core navigation, rewards, and feature access must not depend on
the request. See the [review request guide](https://developers-apps-in-toss.toss.im/documentation/common/growth/review.md)
and [`Review.request`](https://developers-apps-in-toss.toss.im/documentation/sdk/domains-api/review/review.request.md).

## Copy the controller

Copy `templates/clients/review-request/review-request-controller.mjs` into the
consumer app and keep one controller for the app lifecycle. The factory reuses
the same controller when it receives the same storage object and storage key.
Do not create a new controller in each screen component. If the app wraps the
same persistent store in a new object, keep the controller at a higher scope so
the in-memory session lock is still shared.

The injected `getScreenState()` must return strict boolean fields:

```js
{
  foreground: true,
  blockingOverlay: false,
  contextKey: accountOrSessionKey
}
```

Malformed state is treated as blocked. Change `contextKey` when the account or
active session changes; a response that arrives for an older context is then
discarded before the SDK call.

## Connect it after the core action

Use the platform adapter from `@ait-kit/sdk@0.4.0` and inject the app's own
storage and eligibility rules. RN and Web use separate entry points:

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

  // The required task and completion UI do not wait for an optional review.
  void reviewController.maybeRequest();
}
```

For Web, import `createWebReview` from `@ait-kit/sdk/web`. The example
cooldown is an app setting, not an Apps in Toss limit. The controller writes an
attempt before `review.request()` and keeps that record after success, failure,
or a UI that is not shown. A storage read/write failure skips the review so it
cannot fail the core action.

The controller reports only these event types:

- `review_request_attempted`: the SDK call is about to start.
- `review_request_skipped`: the app did not start the call, with a safe reason
  such as `cooldown`, `in_flight`, `stale_context`, or `unsupported`.
- `review_request_failed`: the support check, storage, telemetry, or SDK call
  failed. Only an error code is retained.
- `review_request_settled`: the SDK promise settled; this is not a review result.

The returned status is `settled`, `failed`, or `skipped`. None of these statuses
means that a user wrote a review. Do not store ratings, `shown`, `submitted`,
`reviewed`, or reward eligibility in this controller.

## Check installed SDK compatibility

The kit's metadata-only diagnostic reads package manifests and the actual
resolved package versions. It does not import SDK code, install packages, or
edit a lockfile:

```bash
node vendor/trailbase-apps-in-toss-kit/scripts/check-consumer-sdk-compatibility.mjs \
  --root /path/to/consumer-app --runtime rn --json
```

Use `--runtime web` for a WebView app. The result includes the selected
`@ait-kit/sdk` peer range and the installed official SDK version. Toss app
runtime support is always reported as `not_checked`; run the app's manual device
smoke test before changing its supported SDK policy.

This controller is for review prompting only. It does not grant promotion
rewards, infer review completion, or fall back between client and server
payment paths.
