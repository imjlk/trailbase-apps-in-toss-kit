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
import { createAnalyticsRouter } from "@trailbase-apps-in-toss-kit/trailbase-client/analytics";

const analytics = createAnalyticsRouter({
  detail: false,
  appsInToss: false,
  debug: false,
});
```

모든 sink는 기본적으로 꺼져 있습니다. 컨슈머 앱이 초기화 단계에서 필요한 sink만 켭니다.

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
      // 실제 콘솔 이벤트 표면은 앱 로컬의 Analytics.Press/Impression/Area wrapper에서
      // 처리하세요. router는 공유 이벤트 매핑과 설정을 유지합니다.
      console.debug("[apps-in-toss-analytics]", event);
    },
  },
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
