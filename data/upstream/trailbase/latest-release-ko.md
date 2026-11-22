# TrailBase v0.36.1

- 게시 시각: 2026-11-18T16:35:29Z
- 릴리스 URL: https://github.com/trailbaseio/trailbase/releases/tag/v0.36.1

## 릴리스 노트

- 신뢰하는 (리버스) 프록시 구성을 지정하는 `ProxyConfig`를 추가했습니다. 프록시가 넘겨준 헤더에서 클라이언트 IP를 더 좁고 정확하며 안전하게 추출할 수 있습니다.
  - 예를 들어 여러 프록시가 이어진 구성이라면 로깅과 rate limiting에 `X-Forwarded-For`에서 프록시가 아닌 가장 오른쪽 IP를 쓰도록 설정할 수 있습니다.
- Admin UI: `ERD` 그래프 노드 위치를 유지합니다.
- Rust와 JavaScript 의존성을 업데이트했습니다. 보안 권고에 대응합니다.

전체 변경 내역: https://github.com/trailbaseio/trailbase/compare/v0.36.0...v0.36.1
