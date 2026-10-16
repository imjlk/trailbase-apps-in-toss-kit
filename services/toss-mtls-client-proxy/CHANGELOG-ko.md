# @trailbase-apps-in-toss-kit/toss-mtls-client-proxy

## 0.7.0 — 2026-10-16

### 마이너 변경

- [6fe06ec](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/6fe06ec6794fb916e23ed76a29d5ac1e531f4ff9) api-core·api-client 0.6.0을 채택하고 익명 인증 코드의 비공개 일회용 교환 경로를 추가합니다. `anonymous-key.exchange-auth-code` capability와 forward mode·내부 bearer 인증이 필요하며 stub 식별자나 자동 코드 재시도는 제공하지 않습니다. WebView SDK 3.6+ 클라이언트의 새 코드를 서버에서 교환한 결과만 호출자 식별로 사용하세요. 기존 verify는 키 유효성만 확인합니다. 원본 키는 백엔드 경계 안에서만 취급하고 코드·키를 저장·로그·공개 응답에 넣지 마세요. HMAC seed·계정 매핑은 유지하며 코드 교환 자체의 스키마 변경은 없습니다. — @imjlk의 기여입니다.

### 패치 변경

- 의존성 업데이트: trailbase-runtime (npm)@0.8.1.

이전 변경 이력은 [영어 원문](CHANGELOG.md)을 참고하세요.
