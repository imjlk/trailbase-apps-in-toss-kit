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
import { createAnalyticsRouter } from "@trailbase-apps-in-toss-kit/ait-rn/analytics";

const analytics = createAnalyticsRouter({
  detail: false,
  appsInToss: false,
  debug: false,
});
```

All sinks are disabled by default. Consumers opt in during app initialization.

## Bootstrap-controlled opt-in logging

For production apps, prefer enabling analytics from the app bootstrap response instead of shipping a
hard-coded client decision. Missing or invalid policy values normalize to disabled.

```json
{
  "enabled": true,
  "trailbase": {
    "enabled": true,
    "endpoint": "/api/analytics/events",
    "sampleRate": 1,
    "maxBatchSize": 20,
    "maxQueueSize": 200,
    "flushIntervalMs": 5000,
    "maxPayloadBytes": 4096,
    "allowedEvents": ["screen_view", "answer_submit_tapped"]
  },
  "appsInToss": {
    "enabled": true,
    "allowedEvents": ["screen_view", "answer_submit_tapped"]
  }
}
```

```ts
import { Analytics } from "@apps-in-toss/framework";
import {
  configureAppsInTossAnalyticsRouterFromBootstrap,
  createAnalyticsRouter,
} from "@trailbase-apps-in-toss-kit/ait-rn/analytics";

const analytics = createAnalyticsRouter({
  detail: false,
  appsInToss: false,
});

configureAppsInTossAnalyticsRouterFromBootstrap({
  router: analytics,
  policy: bootstrap.analytics,
  trailbase: {
    baseUrl: apiBaseUrl,
    getAuthHeaders: () => ({
      Authorization: `Bearer ${sessionTokenStore.current}`,
    }),
  },
  appsInToss: {
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
      console.debug("[apps-in-toss-analytics]", event);
    },
  },
  sessionTokenProvider: () => sessionTokenStore.current,
});
```

`trailbase.endpoint` is an app backend endpoint. The client sends `POST { events }` batches there;
the backend decides which TrailBase table, database, or multi-db connection to use. The shared sink is
in-memory only: it supports allowlists, sampling, queue caps, batch flushing, and payload sanitization,
but it does not provide a persistent offline queue.

## Optional TrailBase analytics database

For higher-volume detailed analytics, prefer a separate TrailBase database instead of mixing product
tables and analytics writes in `main`. Configure the consumer app's `config.textproto` with:

```textproto
databases: [{
  name: "analytics"
}]
```

Place analytics migrations under `traildepot-template/migrations/analytics/` and copy the
[`analytics_events.sql`](../../templates/trailbase/sql/analytics_events.sql) snippet into an app-owned
`U<timestamp>__create_analytics_events.sql` migration. The shared runtime migration copier now copies
all `migrations/<database>/` subdirectories, including `main` and `analytics`.

TrailBase applies custom database migrations when a connection references the configured database. The
smoke script creates a temporary ACL-less Record API only to force an `analytics` attachment and verify
the migration; production apps should keep analytics writes behind app-owned backend or WASM endpoints
rather than exposing a public analytics Record API.

Rust WASM endpoints can use `trailbase_guest_common::analytics_events` to build inserts against the
attached `analytics.analytics_events` table after the endpoint connection has attached the analytics
database. Keep the API endpoint app-owned: validate the current TrailBase user/session, attach request
or batch IDs, and never store raw Toss user keys, auth tokens, mTLS proxy tokens, or feature ledgers in
analytics payloads.

To verify the template against the currently verified TrailBase image:

```bash
bun scripts/smoke-trailbase-analytics-multidb.mjs
```

Set `TRAILBASE_IMAGE=trailbase/trailbase:<version>` to test another image, or
`KEEP_TRAILBASE_SMOKE_DIR=1` to inspect the temporary `traildepot`.

Use `@trailbase-apps-in-toss-kit/ait-rn/analytics` when wiring the official AppsInToss `Analytics`
SDK. The lower-level `trailbase-client/analytics` APIs remain framework-neutral primitives for routers,
buffered sinks, sanitizers, and backend batch posting.

AppsInToss Analytics is the official console metric source. The TrailBase mirror is for app-internal
analysis and early operations support when teams need lower-latency or richer debugging data.

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
import {
  createAnalyticsRouter,
  createAppsInTossAnalyticsConfig,
} from "@trailbase-apps-in-toss-kit/ait-rn/analytics";

const analytics = createAnalyticsRouter({
  appsInToss: createAppsInTossAnalyticsConfig({
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
  }),
});
```

For console analytics, prefer wrapping meaningful UI surfaces with `Analytics.Press`, `Analytics.Impression`, or `Analytics.Area`. Keep high-frequency debug events such as text input changes in detailed analytics only.

## Recommended event policy

- Keep event names stable and snake_case.
- Track meaningful product actions: first screen/round impression, answer submit, question replay, hint request, ad CTA, reward claim, notification settings.
- Do not send noisy debug events to AppsInToss Analytics.
- Use detailed analytics for backend/API failures, retry paths, queue state, and temporary launch diagnostics.
- If detailed analytics is not needed for a consumer app, set `detail: false`; the same `track()` calls become no-op for that sink.
- Do not mix functional ledgers into the analytics sink. Notification agreement history, message outbox,
  promotion claim/grant, IAP order/grant, and ad/share reward records should stay in their feature-owned
  tables and docs.
