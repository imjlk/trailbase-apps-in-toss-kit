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

도메인별 클라이언트 함수는 앱 패키지에 남기세요. kit는 재사용 가능한 전송 계층과 어댑터
조각만 제공합니다.

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
