# Analytics router

AppsInToss services often need two different analytics layers.

## Definitions

- **Detailed analytics** is an app-owned TrailBase event stream. Use it for first-action funnels, round state debugging, ad/reward/notification diagnostics, and product iteration before console analytics is available.
- **AppsInToss Analytics** is the official console analytics layer for launched mini-apps. Use it for selected screen, click, and impression events that should appear in the AppsInToss console.

AppsInToss Analytics has product constraints that are easy to miss:

- SDK version `v1.0.3` or later is required.
- Sandbox and QR test traffic is not collected.
- Console data appears from launch day +1 in **Analytics > Events**.
- The SDK surface is component-oriented: `Analytics.Press`, `Analytics.Impression`, and `Analytics.Area`.

Keep detailed analytics and AppsInToss Analytics separate. A detailed TrailBase event can include debug-only payload, but AppsInToss console events should stay low-volume and product-facing.

## Basic setup

```ts
import { createAnalyticsRouter } from "@trailbase-apps-in-toss-kit/trailbase-client/analytics";

const analytics = createAnalyticsRouter({
  detail: false,
  appsInToss: false,
  debug: false,
});
```

All sinks are disabled by default. Consumers opt in during app initialization.

## Enable detailed analytics

```ts
const analytics = createAnalyticsRouter({
  screen: "main",
  detail: {
    enabled: true,
    sessionTokenProvider: () => sessionTokenStore.current,
    enqueueBatch: (events) => {
      localTrailBaseQueue.enqueue(events);
    },
  },
});

analytics.track("answer_submit_tapped", {
  roundNo: 12,
  correctCount: 1,
});
```

The kit does not force a database schema or API endpoint. Consumer apps own their TrailBase event table and batch endpoint.

## Enable AppsInToss Analytics

```ts
import { Analytics } from "@apps-in-toss/framework";

const analytics = createAnalyticsRouter({
  appsInToss: {
    enabled: true,
    analyticsModule: Analytics,
    mapEvent: (event) => {
      if (event.eventName !== "answer_submit_tapped") {
        return false;
      }
      return {
        name: "answer_submit",
        type: "press",
        params: event.eventPayload,
      };
    },
    dispatch: (event) => {
      // Use app-local wrappers around Analytics.Press/Impression/Area for the
      // real console event surface. The router keeps the shared event mapping.
      console.debug("[apps-in-toss-analytics]", event);
    },
  },
});
```

For console analytics, prefer wrapping meaningful UI surfaces with `Analytics.Press`, `Analytics.Impression`, or `Analytics.Area`. Keep high-frequency debug events such as text input changes in detailed analytics only.

## Recommended event policy

- Keep event names stable and snake_case.
- Track meaningful product actions: first screen/round impression, answer submit, question replay, hint request, ad CTA, reward claim, notification settings.
- Do not send noisy debug events to AppsInToss Analytics.
- Use detailed analytics for backend/API failures, retry paths, queue state, and temporary launch diagnostics.
- If detailed analytics is not needed for a consumer app, set `detail: false`; the same `track()` calls become no-op for that sink.
