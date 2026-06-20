# Analytics router

AppsInToss 서비스에서는 보통 서로 다른 두 분석 계층이 필요합니다.

## 정의

- **상세 분석**은 앱이 소유하는 TrailBase 이벤트 스트림입니다. 첫 행동 퍼널, 라운드 상태
  디버깅, 광고/보상/알림 진단, 콘솔 분석이 보이기 전 제품 개선에 사용합니다.
- **AppsInToss Analytics**는 출시된 미니앱의 공식 콘솔 분석 계층입니다. AppsInToss 콘솔에
  노출되어야 하는 화면, 클릭, 노출 이벤트만 선별해 사용합니다.

AppsInToss Analytics에는 놓치기 쉬운 제품 제약이 있습니다.

- SDK `v1.0.3` 이상이 필요합니다.
- 샌드박스와 QR 테스트 트래픽은 수집되지 않습니다.
- 콘솔 데이터는 런칭 다음 날(+1일)부터 **분석 > 이벤트**에서 확인할 수 있습니다.
- SDK 표면은 `Analytics.Press`, `Analytics.Impression`, `Analytics.Area`처럼 컴포넌트
  중심입니다.

상세 분석과 AppsInToss Analytics를 분리해서 관리하세요. TrailBase 상세 이벤트에는 디버그용
payload를 담을 수 있지만, AppsInToss 콘솔 이벤트는 저빈도 제품 이벤트로 유지하는 편이
좋습니다.

## 기본 설정

```ts
import { createAnalyticsRouter } from "@trailbase-apps-in-toss-kit/ait-rn/analytics";

const analytics = createAnalyticsRouter({
  detail: false,
  appsInToss: false,
  debug: false,
});
```

모든 sink는 기본적으로 꺼져 있습니다. 컨슈머 앱이 초기화 단계에서 필요한 sink만 켭니다.

## 부트스트랩 제어 opt-in 로깅

프로덕션 앱에서는 클라이언트에 분석 활성 여부를 하드코딩하기보다 앱 bootstrap 응답에서 정책을 받아
켜는 방식을 권장합니다. 값이 없거나 잘못된 정책은 disabled로 정규화됩니다.

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

`trailbase.endpoint`는 앱 백엔드 endpoint입니다. 클라이언트는 해당 endpoint로 `POST { events }`
batch를 보내고, 실제 TrailBase table, database, multi-db 연결 선택은 백엔드가 결정합니다. 공유
sink는 in-memory 전용입니다. allowlist, sampling, queue cap, batch flush, payload sanitization은
지원하지만 persistent offline queue는 제공하지 않습니다.

## 선택형 TrailBase analytics database

상세 분석 이벤트 양이 많다면 제품 테이블과 분석 쓰기를 `main`에 섞기보다 별도 TrailBase
database를 권장합니다. 도입 앱의 `config.textproto`에 다음을 추가하세요.

```textproto
databases: [{
  name: "analytics"
}]
```

Analytics migration은 `traildepot-template/migrations/analytics/` 아래에 두고,
[`analytics_events.sql`](../../templates/trailbase/sql/analytics_events.sql) 조각을 앱 소유
`U<timestamp>__create_analytics_events.sql` migration으로 복사합니다. 공통 runtime migration
copier는 이제 `main`과 `analytics`를 포함한 모든 `migrations/<database>/` 하위 디렉터리를
복사합니다.

TrailBase custom database migration은 설정된 database를 참조하는 connection이 열릴 때 적용됩니다.
Smoke script는 `analytics` attach와 migration 적용을 확인하기 위해 임시 ACL 없는 Record API를 만들지만,
운영 앱에서는 public analytics Record API를 노출하지 말고 앱 소유 backend/WASM endpoint 뒤에서 analytics
write를 처리하세요.

Rust WASM endpoint에서는 `trailbase_guest_common::analytics_events`를 사용해 attached
`analytics.analytics_events` table insert를 만들 수 있습니다. 이 helper는 endpoint connection이
analytics database를 attach한 뒤 사용하세요. API endpoint는 앱이 소유합니다. 현재 TrailBase
user/session을 검증하고 request 또는 batch ID를 붙이되, 원본 Toss user key, auth token,
mTLS proxy token, 기능성 ledger를 analytics payload에 저장하지 마세요.

현재 검증된 TrailBase image로 템플릿을 확인하려면 다음 smoke를 실행합니다.

```bash
bun scripts/smoke-trailbase-analytics-multidb.mjs
```

다른 image를 확인하려면 `TRAILBASE_IMAGE=trailbase/trailbase:<version>`을 지정하고, 임시
`traildepot`을 확인하려면 `KEEP_TRAILBASE_SMOKE_DIR=1`을 지정하세요.

공식 AppsInToss `Analytics` SDK를 연결할 때는 `@trailbase-apps-in-toss-kit/ait-rn/analytics`를
사용하세요. 하위 `trailbase-client/analytics` API는 router, buffered sink, sanitizer, backend
batch posting을 위한 framework-neutral primitive로 남겨둡니다.

AppsInToss Analytics는 공식 콘솔 지표의 기준입니다. TrailBase mirror는 더 빠른 확인이나 더 풍부한
디버깅 데이터가 필요한 앱 내부 분석/초기 운영 보조 용도입니다.

## 상세 분석 켜기

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

kit은 데이터베이스 schema나 API endpoint를 강제하지 않습니다. TrailBase 이벤트 테이블과 batch
endpoint는 컨슈머 앱이 소유합니다.

## AppsInToss Analytics 켜기

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
      // 실제 콘솔 이벤트 표면은 앱 로컬의 Analytics.Press/Impression/Area wrapper에서
      // 처리하세요. router는 공유 이벤트 매핑과 설정을 유지합니다.
      console.debug("[apps-in-toss-analytics]", event);
    },
  }),
});
```

콘솔 분석에는 의미 있는 UI 표면만 `Analytics.Press`, `Analytics.Impression`,
`Analytics.Area`로 감싸는 방식을 권장합니다. 텍스트 입력 변경 같은 고빈도 디버그 이벤트는
상세 분석에만 남기세요.

## 권장 이벤트 정책

- 이벤트 이름은 안정적인 `snake_case`로 유지합니다.
- 첫 화면/라운드 노출, 정답 제출, 문제 다시보기, 힌트 요청, 광고 CTA, 보상 수령, 알림 설정처럼
  제품적으로 의미 있는 행동을 수집합니다.
- 시끄러운 디버그 이벤트는 AppsInToss Analytics로 보내지 않습니다.
- 백엔드/API 실패, 재시도 경로, queue 상태, 출시 초기 임시 진단은 상세 분석으로 다룹니다.
- 상세 분석이 필요 없는 컨슈머 앱은 `detail: false`로 둡니다. 같은 `track()` 호출을 유지해도
  해당 sink는 no-op으로 동작합니다.
- 기능성 원장 데이터는 analytics sink에 섞지 않습니다. 알림동의 이력, message outbox, promotion
  claim/grant, IAP order/grant, 광고/공유 reward 기록은 각 기능이 소유하는 table과 문서에서
  다룹니다.
