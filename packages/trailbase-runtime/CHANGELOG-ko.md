# @trailbase-apps-in-toss-kit/trailbase-runtime

## 0.8.1 — 2026-10-16

### 패치 변경

- [1d97c6f](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/1d97c6f93cc8bc6ba9623a64365f7e00917d86cd) 실행을 claim하지 않았고 마지막 활동이 기준 시각보다 오래된 three-step 프로모션 의도를 정리하는 `abandon_unexecuted_promotion_reward_ledgers_tx`를 추가합니다. 최근 재시도·실행을 시작한 행·레거시 행은 보호합니다. 기존 v2 컨슈머는 정리 활성화 전에 additive `promotion_reward_ledger.v3.sql` 인덱스 마이그레이션을 적용해야 하며 새 설치에는 포함됩니다. Ledger Doctor는 종료된 `NOT_EXECUTED` 행에 제공자 조회나 자동 재시도를 권하지 않습니다. — @imjlk의 기여입니다.

- [63fca33](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/63fca330173ae73aeafb2f860693e921671fe4c8) `proxy-capabilities` export에 TypeScript 선언을 제공합니다. strict Bundler·NodeNext 컨슈머는 로컬 ambient module shim 없이 health 평가기와 check factory를 사용할 수 있습니다. fetch 주입과 성공·실패 결과 narrowing을 포함하며 JavaScript 동작과 자격 증명 처리는 유지합니다. — @imjlk의 기여입니다.
- [c8bfd76](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/c8bfd765f1de81e6b17947fe6349e9255ad502d7) Docker builder 한도, 공유 임시 경로, 리소스 제한 통합 fixture를 위한 비공개 컨슈머 CI runner 복사 헬퍼를 제공합니다. 컨슈머 서버·릴리즈 정책은 변경하지 않습니다. — @imjlk의 기여입니다.

이전 변경 이력은 [영어 원문](CHANGELOG.md)을 참고하세요.
