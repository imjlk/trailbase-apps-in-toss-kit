# trailbase-guest-common

## 0.15.0 — 2026-10-16

### 마이너 변경

- [6fe06ec](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/6fe06ec6794fb916e23ed76a29d5ac1e531f4ff9) `@ait-kit/sdk` 0.7.0과 api-core·api-client 0.6.0을 채택합니다. 공식 WebView SDK 3.6+에서 새 익명 인증 코드를 발급하고 비공개 forward 프록시와 Rust 헬퍼로 한 번 교환한 뒤 공식 TrailBase 로그인을 진행할 수 있습니다. 기존 키 verify는 유효성만 확인하며 호출자 소유를 증명하지 않습니다. 도입 전에 `anonymous-key.exchange-auth-code` capability를 확인하고 코드·원본 키를 저장·로그·공개 응답에 넣지 마세요. 기존 HMAC seed와 계정 매핑을 유지하며 코드 교환 자체에는 스키마 migration이 없습니다. 이전 SDK에서는 이 선택적 메서드를 hash나 로그인으로 대체하지 않고 미지원으로 반환합니다. — @imjlk의 기여입니다.

- [1d97c6f](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/1d97c6f93cc8bc6ba9623a64365f7e00917d86cd) 실행을 claim하지 않았고 마지막 활동이 기준 시각보다 오래된 three-step 프로모션 의도를 정리하는 `abandon_unexecuted_promotion_reward_ledgers_tx`를 추가합니다. 최근 재시도·실행을 시작한 행·레거시 행은 보호합니다. 기존 v2 컨슈머는 정리 활성화 전에 additive `promotion_reward_ledger.v3.sql` 인덱스 마이그레이션을 적용해야 하며 새 설치에는 포함됩니다. Ledger Doctor는 종료된 `NOT_EXECUTED` 행에 제공자 조회나 자동 재시도를 권하지 않습니다. — @imjlk의 기여입니다.

### 패치 변경

- [1b2ef95](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/1b2ef95026bf0843c78c324733b479b2a116d70b) 프로모션 응답의 단순 `ok:false`를 `FAILED`로 확정하지 않습니다. 프록시 timeout, 인증·5xx 오류, 모순되는 상태는 `UNKNOWN`과 원장 `pending`으로 유지해 status 조회로 정산하며, 이미 지급됐을 수 있는 보상을 재지급하지 않습니다. 명시적인 제공자 `FAILED`/`ERROR`만 종료 실패로 유지합니다. 서버가 직접 메시지를 큐에 넣는 앱을 위해 기능성 메시지 클라이언트의 `requestMessage`는 선택 사항이 됩니다. — @imjlk의 기여입니다.
- [4c09667](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/4c09667f6bebc2e6bcb79df0a8c6b6255572e81f) 선택적으로 켜는 bootstrap 단계별 진단과 의존성 없는 복사 템플릿을 추가합니다. 내부 TrailBase 인증 origin과 공식 로그인·비밀번호 회전을 유지하고, 운영 지연을 네트워크·DB 문제로 판단하기 전에 단계별 시간을 비교하세요. — @imjlk의 기여입니다.

이전 변경 이력은 [영어 원문](CHANGELOG.md)을 참고하세요.
