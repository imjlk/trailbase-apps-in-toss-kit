# @trailbase-apps-in-toss-kit/ait-rn

## 0.9.2 — 2026-10-16

### 패치 변경

- [6fe06ec](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/6fe06ec6794fb916e23ed76a29d5ac1e531f4ff9) `@ait-kit/sdk` 0.7.0을 채택하고 기존 RN peer·API 호환성을 유지합니다. 이번 익명 코드 발급 기능은 공식 WebView SDK 3.6+용이며 RN에 자동으로 추가되는 기능이 아닙니다. api-core·api-client 0.6.0과 `anonymous-key.exchange-auth-code` capability의 비공개 forward 프록시·Rust 교환 경로는 소비 앱이 명시적으로 연결해야 합니다. 미지원 runtime에 인증을 강제 추가하지 않습니다. 기존 키 유효성 확인을 호출자 인증으로 사용하거나 코드 인증을 hash로 대체하지 마세요. HMAC seed·계정 매핑은 유지하며 코드 교환 자체의 스키마 변경은 없습니다. 코드·원본 키를 저장·로그·공개 응답에 넣지 마세요. — @imjlk의 기여입니다.

- [1b2ef95](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/1b2ef95026bf0843c78c324733b479b2a116d70b) 프로모션 응답의 단순 `ok:false`를 `FAILED`로 확정하지 않습니다. 프록시 timeout, 인증·5xx 오류, 모순되는 상태는 `UNKNOWN`과 원장 `pending`으로 유지해 status 조회로 정산하며, 이미 지급됐을 수 있는 보상을 재지급하지 않습니다. 명시적인 제공자 `FAILED`/`ERROR`만 종료 실패로 유지합니다. 서버가 직접 메시지를 큐에 넣는 앱을 위해 기능성 메시지 클라이언트의 `requestMessage`는 선택 사항이 됩니다. — @imjlk의 기여입니다.

이전 변경 이력은 [영어 원문](CHANGELOG.md)을 참고하세요.
