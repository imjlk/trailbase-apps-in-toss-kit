# 문서 안내

이 문서는 AppsInToss 서비스에 `trailbase-apps-in-toss-kit`를 붙이거나 유지보수하는
사람을 위한 안내서입니다. Kit가 대신해 주는 일과, 각 앱이 계속 직접 책임져야 하는
일을 구분해서 설명합니다.

이 kit는 대부분의 기능에서 TrailBase를 백엔드 실행 환경으로 전제합니다. 각 앱은
TrailBase로 SQLite 데이터베이스, Record API, Rust WASM 핸들러, 작업, TrailBase 실행
디렉터리(`traildepot`)를 운영하고, kit는 여러 앱에서 반복되는 주변 코드를 공통화합니다.

예외적으로 Toss mTLS 프록시는 TrailBase에 묶여 있지 않습니다. 같은 사설 네트워크에서
HTTP로 호출할 수 있다면 다른 백엔드에서도 재사용할 수 있습니다.

AI 코딩 에이전트는 이 문서보다 먼저 `AGENTS.md`를 읽어야 합니다. TrailBase 마이그레이션,
배포, mTLS 관련 작업에는 `trailbase-ops` 스킬을 함께 사용하세요.

## 어디부터 읽을까

| 하고 싶은 일 | 읽을 문서 |
| --- | --- |
| 기존 서비스에 kit 붙이기 | [consumer-migration.md](consumer-migration.md) |
| 컨테이너 시작 스크립트 공통화 이해하기 | [trailbase-runtime.md](trailbase-runtime.md) |
| Toss mTLS 프록시 안전하게 운영하기 | [toss-mtls-client-proxy.md](toss-mtls-client-proxy.md) |
| 운영 환경 변수 검증하기 | [production-env-validation.md](production-env-validation.md) |
| SQL 마이그레이션과 Record API 노출 설계하기 | [schema-patterns.md](schema-patterns.md) |
| 익명 사용자를 Toss Login 사용자와 연결하기 | [toss-identity.md](toss-identity.md) |
| Toss 프로모션 리워드 캠페인 설계하기 | [promotion-campaigns.md](promotion-campaigns.md) |
| 기능성 푸시/알림 메시지 붙이기 | [functional-messages.md](functional-messages.md) |
| React Native 클라이언트 어댑터 사용하기 | [client-adapters.md](client-adapters.md) |
| 버전과 GHCR 이미지 배포 흐름 이해하기 | [versioning.md](versioning.md), [publishing.md](publishing.md) |
| Sampo changeset으로 릴리스 노트 초안 만들기 | [sampo-release-notes.md](sampo-release-notes.md) |
| TrailBase 업스트림 호환성 추적하기 | [trailbase-tracking.md](trailbase-tracking.md) |
| Apps in Toss SDK/API 문서 추적하기 | [apps-in-toss-tracking.md](apps-in-toss-tracking.md) |
| 에이전트 스킬 설치 또는 기여하기 | [agent-skills.md](agent-skills.md) |

## 기본 관점

이 kit는 호스팅 플랫폼(hosted platform)이 아니라 공유 도구 모음(shared toolbox)입니다. 보통
사용하는 방식은 세 가지입니다.

1. Git 하위 모듈(submodule)에서 Rust와 TypeScript 헬퍼를 소스 그대로 가져다 씁니다.
2. SQL, Compose, 환경 변수, 스모크 테스트 템플릿은 앱 저장소로 복사한 뒤 앱에서 관리합니다.
3. 공통 mTLS 프록시 컨테이너는 사설 내부 서비스로 실행합니다.

`templates/`에서 복사한 파일은 그때부터 앱의 소유입니다. 하위 모듈을 업데이트해도 앱
저장소에 복사된 마이그레이션, Compose 파일, 운영 환경 변수 파일은 자동으로 바뀌지
않습니다.

## 참고 문서

kit의 해석이 아니라 원본 도구의 동작 자체를 확인해야 할 때는 아래 문서를 보세요.

- TrailBase: [홈](https://trailbase.io/),
  [Record APIs](https://trailbase.io/documentation/apis_record/),
  [migrations](https://trailbase.io/documentation/migrations/),
  [production](https://trailbase.io/documentation/production/).
- AppsInToss: [Developer Center](https://developers-apps-in-toss.toss.im/).
- 배포와 실행 환경: [Coolify Docker Compose](https://coolify.io/docs/knowledge-base/docker/compose),
  [Bun](https://bun.com/docs).
- 클라이언트 어댑터: [TanStack DB](https://tanstack.com/db/latest/docs),
  [TanStack Query](https://tanstack.com/query/latest/docs/framework/react/overview).

## 언어

영문 문서는 `docs/en/`에 있고, 같은 파일명의 한글 문서는 `docs/ko/`에 있습니다.
