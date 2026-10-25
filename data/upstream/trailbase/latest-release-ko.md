# TrailBase v0.35.2

- 게시 시각: 2026-10-21T17:02:14Z
- 릴리스 URL: https://github.com/trailbaseio/trailbase/releases/tag/v0.35.2

## 릴리스 노트

- 처리 대기 작업이 많은 상태에서도 DB가 정상 종료되도록 수정하고, 로그를 안전하게 기록할 수 있도록 대기 시간을 늘렸습니다. 처리량이 늘어나면서 드러난 문제입니다.
- `User`와 `DbUser`의 메모리 표현을 정리해 처리량을 약 5% 높였습니다. 최적화를 계속 진행하면서 작은 개선도 의미가 커지고 있습니다.
- 서버를 시작하지 않고도 migration을 적용할 수 있도록 `trail migration` CLI 명령을 확장했습니다.
- 의존성을 업데이트하고 Wasmtime 보안 권고에 대응했습니다.

전체 변경 내역: https://github.com/trailbaseio/trailbase/compare/v0.35.1...v0.35.2
