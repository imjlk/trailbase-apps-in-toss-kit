# 소비자 앱의 참여 신호

`@trailbase-apps-in-toss-kit/ait-rn/engagement`는 선택적으로 연결하는 작은
컨트롤러를 제공합니다. 라우트, 계정 상태, 쿼리 캐시와 UX는 소비자 앱이 소유합니다.
화면 복원, 점수 제출, 보상 지급, 변경 요청 재실행은 수행하지 않습니다.
서버 마이그레이션이나 SDK 의존성 업그레이드는 필요하지 않습니다.

## 유입경로와 실제 노출

앱 시작 시 Granite `InitialProps`의 최초 `scheme`을 캡처하여
`entryReferrerFromScheme`에 전달합니다. 문서에 정의된 유입경로만 보존하며,
누락·중복·잘못된 형식·알 수 없는 값은 `unknown`이 됩니다.
로그인 API의 `DEFAULT`/`SANDBOX` referrer와 구분합니다.
이 세션의 유입경로는 메모리에 보관하고 기존 분석 이벤트에 연결합니다.
실행 URL, 임의 쿼리 파라미터, 비공개 투표 내용은 보내지 않습니다.
referrer는 클라이언트 분석용 힌트이며 권한 판정 근거가 아닙니다.

`IOScrollView` 내부의 Granite `ImpressionArea` 또는 지원되는 IO 컨테이너의
`InView`로 요소 노출을 감지합니다. 요소와 화면이 모두 보일 때만
`createExposureTracker().setVisible()`에 true를 전달합니다. 기본값은 연속
1초 노출이며 tracker 인스턴스당 한 번 기록합니다. 노출 비율, 구분 키와 콜백은
소비자가 결정합니다. 언마운트 시 dispose하고, 백그라운드나 화면 밖으로 나가면
대기 타이머를 취소합니다. 비동기 분석 전송 실패는 격리됩니다.
생성/render, 실제 노출, 클릭, 이동 요청과 확인된 업무 결과를 별도 이벤트로
유지합니다. SDK 광고 노출은 기존 광고 impression 콜백을 기준으로 합니다.

## 화면 복귀와 연결 상태

화면 생명주기마다 `createForegroundRefreshController`를 생성합니다.
`ait-rn/runtime`의 `safeGetAppsInTossNetworkStatus`, **조회 전용** 갱신 콜백,
선택적 `onStatus` 관찰자를 주입합니다. SDK 화면 가시성과 계정/세션 구분 키를
`setActive`에 전달하고 변경 요청이나 차단 모달이 진행 중이면 비활성화합니다.
최초 활성화는 연결만 확인하여 초기 조회를 중복하지 않습니다. 복귀 시 기본
15초 간격으로 갱신하며, 명시적인 `retry()`는 이 간격을 적용하지 않습니다.

`OFFLINE`은 갱신을 건너뜁니다. `UNKNOWN`, API 부재·실패, 응답 없는 네이티브
조회는 일반 읽기를 허용하므로 감지 기능 때문에 앱을 잠그지 않습니다.
연결 상태만으로 앱 서버의 정상 응답을 보장하지 않습니다. 네트워크 변경 구독을
가정하지 않으며 활성화와 명시적 재시도 때 확인합니다. 조회 실패는 별도로 알립니다.
언마운트 시 dispose하면 이전 문맥의 늦은 연결/상태 응답을 무시합니다.
쿼리 취소와 계정별 캐시 분리는 앱이 담당합니다.

## 리뷰 요청

네이티브 리뷰 브리지를 다시 구현하지 않고 `@ait-kit/sdk/rn`과 기존
[리뷰 컨트롤러](review-request.md)를 재사용합니다. TypeScript 앱은 `.mjs`와
`.d.mts` 선언을 함께 복사합니다. 컨트롤러는 비동기 쿨다운 기록 이후 화면/계정을
다시 확인합니다. 오래된 요청을 건너뛰더라도 보수적으로 시도 시각을 유지합니다.
대상 조건, 간격, 모달 상태는 앱이 정합니다. 요청 완료가 리뷰 노출이나 작성을
증명하지는 않습니다.

출처: [리뷰](https://developers-apps-in-toss.toss.im/documentation/common/growth/review),
[노출](https://developers-apps-in-toss.toss.im/documentation/react-native/impression),
[유입경로](https://developers-apps-in-toss.toss.im/documentation/common/growth/analytics/referrer),
[화면 가시성](https://developers-apps-in-toss.toss.im/documentation/react-native/screen-navigation/event),
[네트워크](https://developers-apps-in-toss.toss.im/documentation/common/network-environment/network).
