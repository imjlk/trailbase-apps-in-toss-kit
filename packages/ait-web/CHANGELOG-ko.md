# @trailbase-apps-in-toss-kit/ait-web

## 0.4.0 — 2026-10-16

### 마이너 변경

- [6fe06ec](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/6fe06ec6794fb916e23ed76a29d5ac1e531f4ff9) `@ait-kit/sdk` 0.7.0의 익명 인증 코드 발급을 연결합니다. 새 선택적 메서드 `createAnonymousKeyAuthCode()`는 공식 WebView SDK 3.6+와 지원 runtime이 필요하며 기존 API의 peer 하한은 유지합니다. 새 코드를 비공개 forward 프록시·Rust 헬퍼로 한 번 교환한 뒤 공식 TrailBase 로그인을 진행하세요. 프록시는 api-core·api-client 0.6.0과 `anonymous-key.exchange-auth-code` capability가 필요합니다. 기존 verify는 키 유효성만 확인하며 소유를 증명하지 않습니다. 코드·원본 키를 저장·로그·공개 응답에 넣지 마세요. HMAC seed·계정 매핑을 유지하며 코드 교환 자체에 스키마 migration은 없습니다. 미지원 runtime에서는 hash나 로그인으로 대체하지 않습니다. — @imjlk의 기여입니다.

이전 변경 이력은 [영어 원문](CHANGELOG.md)을 참고하세요.
