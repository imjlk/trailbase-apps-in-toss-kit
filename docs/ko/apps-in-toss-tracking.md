# Apps in Toss 업스트림 추적

이 저장소는 Apps in Toss 서비스를 위한 TrailBase 통합 kit입니다. Apps in Toss React Native
SDK, Granite runtime, TDS package를 vendoring하지 않습니다. 해당 dependency는 컨슈머 앱이
소유하며, 앱 단위 smoke test 이후에만 업데이트해야 합니다.

## 공식 업스트림 소스

- Release notes: https://developers-apps-in-toss.toss.im/release-note/release-note.md
- LLM index: https://developers-apps-in-toss.toss.im/llms.txt
- React Native tutorial: https://developers-apps-in-toss.toss.im/ai-vibe-coding/tutorials/react-native.md
- React Native reference: https://developers-apps-in-toss.toss.im/documentation/react-native.md
- WebView Client SDK: https://developers-apps-in-toss.toss.im/documentation/sdk.md
- WebView SDK 3.x migration: https://developers-apps-in-toss.toss.im/documentation/integration/sdk-3.x.md
- API overview: https://developers-apps-in-toss.toss.im/documentation/overview.md
- Integration getting started: https://developers-apps-in-toss.toss.im/documentation/integration/getting-started.md
- Server API integration: https://developers-apps-in-toss.toss.im/documentation/integration/server-api.md
- API authentication and mTLS: https://developers-apps-in-toss.toss.im/api/auth.md
- Toss Login API: https://developers-apps-in-toss.toss.im/api/toss-login.md
- In-app purchase API: https://developers-apps-in-toss.toss.im/api/iap.md
- Promotion API: https://developers-apps-in-toss.toss.im/api/promotion.md
- Push and Smart Message API: https://developers-apps-in-toss.toss.im/api/push.md
- Smart Message overview and notification agreement policy: https://developers-apps-in-toss.toss.im/documentation/common/growth/smart-message.md
- Notification agreement SDK: https://developers-apps-in-toss.toss.im/documentation/sdk/domains-api/notification/notification.requestagreement.md
- Non-game user identity key: https://developers-apps-in-toss.toss.im/documentation/sdk/domains-api/user/user.getanonymouskey.md
- Anonymous user key verification API: https://developers-apps-in-toss.toss.im/api/user-key.md
- IAP subscription guide: https://developers-apps-in-toss.toss.im/documentation/common/monetization/iap/in-app-subscription.md
- TDS React Native docs: https://tossmini-docs.toss.im/tds-react-native/

## 호환성 정책

- 컨슈머 SDK, Granite, TDS package version은 앱이 소유합니다.
- 업스트림 추적만을 위해 이 kit의 runtime dependency에 `@apps-in-toss/framework`,
  `@granite-js/react-native`, TDS package를 추가하지 않습니다.
- 저장소 root는 lockfile/reference 및 SDK 타입 검증을 위해 `@apps-in-toss/framework`를 dev dependency로
  고정할 수 있지만, publish/private kit package는 Apps in Toss SDK package를 peer 또는
  주입 dependency로 유지해야 합니다.
- React Native 비게임 mini-app의 익명 TrailBase principal seed는 Apps in Toss
  `getAnonymousKey()`의 `{ type: "HASH", hash }` 결과를 기준으로 합니다.
- 랜덤 local hash나 `createAnonymousHash()` 결과는 local/dev/test fallback이며 production
  identity seed가 아닙니다.
- 비게임 mini-app은 TDS를 반드시 사용해야 합니다. 게임에서는 TDS가 선택 사항입니다.
- 신규 React Native mini-app은 Granite 용어와 framework 1.0 이상을 기준으로 합니다.
- Apps in Toss SDK 3.x는 현재 `@apps-in-toss/web-framework@3.4.0`를 사용하는 WebView
  프로젝트 대상입니다. 이 저장소가 참조하는 React Native
  `@apps-in-toss/framework`의 업데이트 대상과 섞지 않습니다.
- Framework 1.0 이상에서는 `@toss/tds-react-native`를 사용합니다. Legacy framework에서는
  `@toss-design-system/react-native`를 사용했습니다.
- mTLS API 변경은 proxy와 서버 연동 표면에 영향을 줍니다. Login, IAP, promotion,
  Smart Message, 알림 동의문 동작을 함께 검토하세요.
- 사용자가 특정 조건의 향후 알림을 신청하는 기능성 Smart Message 흐름은 서버 발송 전에
  Apps in Toss 알림 동의문 SDK를 사용해야 합니다. SDK에 전달한 `templateCode`는 앱의
  기능성 알림 `template_code`로 저장하세요. 기본 kit SQL은 메시지 `templateSetCode`와
  SDK `templateCode`를 같은 기능성 알림 코드로 관리합니다.
- `requestNotificationAgreement`는 React Native와 WebView SDK v2.5.0 이상에서 문서화되어
  있습니다. 더 낮은 SDK version을 쓰는 컨슈머 앱에서는 사용자가 신청하는 기능성 알림 흐름을
  켜지 마세요.

## Renovate가 추적하는 reference version

<!-- renovate: datasource=npm depName=@apps-in-toss/framework versioning=npm -->
- `apps-in-toss-framework`: `2.10.10`

<!-- renovate: datasource=npm depName=@toss/tds-react-native versioning=npm -->
- `tds-react-native`: `2.0.5`

<!-- renovate: datasource=npm depName=create-granite-app versioning=npm -->
- `create-granite-app`: `1.0.43`

<!-- renovate: datasource=npm depName=@granite-js/react-native versioning=npm -->
- `granite-js-react-native`: `1.0.43`

- `@toss-design-system/react-native`: framework 1.0 이전 프로젝트에서 쓰던 legacy package
  name입니다. 초기 tracking snapshot 시점에는 public npm `latest` metadata를 확인할 수
  없었으므로 신규 앱의 활성 reference로 사용하지 않습니다.

이 Renovate marker block이나 `renovate.json`을 수정했다면 `bun run renovate:validate`로
설정을 검증하세요. 업스트림 snapshot PR이 SDK package 변경을 감지하면 release note를
검토하고 root reference dependency, lockfile, 이 marker를 같은 후속 PR에서 함께 맞추세요.
Snapshot script는 의도적으로 감지만 담당합니다. `packages-snapshot.json`은 npm에서 발견한
버전을, 위 marker는 검토한 reference를 기록합니다. `bun run apps-in-toss:tracking:check`는
root `package.json`과 영문/국문 reference의 일치를 검사합니다. 새 버전 발견은 안내만 하며,
검토 버전을 자동으로 올리거나 감지 전용 PR을 실패시키지 않습니다.

## 최근 검토한 SDK 변경

저장소 reference는 `@apps-in-toss/framework` `2.10.10`까지 검토했습니다.

- `2.8.0`: 비게임 내비게이션 바 테마 설정 기능이 추가되었습니다.
- `2.9.0`: 앱 번들 배포 명령어에 `ait deploy --timeout` 옵션이 추가되었습니다.
- `2.9.2`: 게임 앱에서 Toss 앱 내비게이션 바의 X 버튼을 누르면 종료 확인 모달이 표시됩니다.
  비게임 앱은 기존처럼 바로 종료됩니다.
- `2.10.1`: Metadata 검증용 Apps in Toss reference package family를 갱신합니다.
  컨슈머 앱은 도입 전에 업스트림 SDK release note를 검토하고 앱 단위 smoke test를 실행해야
  합니다.
- `2.10.4`: Metadata 검증용 Apps in Toss framework reference와 Granite package family를
  갱신합니다. 공유 kit API 변경은 필요하지 않습니다.
- `2.10.5`: 내비게이션 바 투명 모드에서 화면 하단 터치가 동작하지 않던 문제를 수정합니다.
- `2.10.6`: 바텀시트 사용 중 간헐적으로 발생하던 WebView 깜빡임을 수정합니다.
- `2.10.7`: Toss 앱 사용량이 많은 사용자가 iOS에서 WebView mini-app을 열 때 간헐적으로
  흰 화면이 나오던 문제를 수정합니다.
- `2.10.8`: React Native mini-app 배너 이미지 표시 규격을 WebView와 맞춥니다.

- `2.10.10`: RN reference를 갱신하고 `bun run packages:typecheck`로 주입 adapter와
  실제 설치된 SDK 타입의 호환성을 검사합니다. SDK에 구독 구매·조회 API가 포함되어 있지만,
  이를 kit에서 사용하는 작업은 별도 기능 변경입니다.
- `2.10.10` 최소 지원 채택: `@ait-kit/sdk` 0.3.0이 peer 하한으로
  `@apps-in-toss/framework@>=2.10.10`을 선언함에 따라, kit의 RN peer 하한과
  최소 버전 fixture alias를 `2.5.0`에서 `2.10.10`으로 함께 올렸습니다. 기본 로더 위임
  경로(로그인, 익명 키, 광고 load, IAP 구매·대기 주문, web identity/저장소/공유)는
  `packages/ait-rn/test/default-loader.test.ts`와
  `packages/ait-web/test/default-loader.test.ts`가 공식 모듈을 mock해 검사합니다.
  실제 토스 앱 검증은 컨슈머 앱의 책임으로 남아 있습니다.

2026년 7월 API 변경으로 promotion·Smart Message는 익명 수신자를 지원합니다. Kit도
이제 익명키 검증, 비공개 identity 저장소, 메시지 수신자 타입, 익명 promotion adapter를
제공합니다. Migration과 동의 요건은 [검증된 익명 사용자 식별](anonymous-identity.md)을
참고하세요. 공개 응답과 로그에는 식별자 원문을 넣지 않습니다.

이번 reference 갱신은 TrailBase 최소 지원 서버 정책을 바꾸지 않습니다. 다만 컨슈머 앱의 지원 Apps in Toss
SDK/runtime policy는 앱 단위 smoke test 이후에만 올리세요.

## Doc Watch 출력물

`Apps in Toss doc watch` workflow는 업스트림 snapshot을 아래 경로에 씁니다.

- `data/upstream/apps-in-toss/docs-snapshot.md`
- `data/upstream/apps-in-toss/docs-snapshot.json`
- `data/upstream/apps-in-toss/packages-snapshot.md`
- `data/upstream/apps-in-toss/packages-snapshot.json`

문서 hash와 npm 발견 버전은 독립적으로 저장합니다. 한쪽 수집이 실패해도 마지막 정상
snapshot을 유지하고 성공한 쪽은 저장합니다. Workflow는 이 변경으로 PR을 생성한 뒤에도
수집 실패를 보고합니다. 내용이 같으면 기존 수집 시각을 유지합니다.

Snapshot은 문서 hash와 npm reference package metadata를 저장합니다. 업스트림 문서 전문을 이
저장소에 복사하지 않습니다. Snapshot 명령은 빈 응답, HTTP 200으로 반환되는 GitBook
`Page Not Found` 문서, 예상 문서 marker가 없는 응답을 거부합니다.

Workflow는 현재 upstream watch PR token으로 `TRAILBASE_RELEASE_WATCH_TOKEN`을 재사용합니다.
이 token은 생성된 PR이 downstream `pull_request` check를 트리거할 수 있도록 이 저장소에
branch push와 pull request 생성 권한이 있어야 합니다.

## Apps in Toss 변경 리뷰 체크리스트

- Release notes에서 React Native SDK 2.x와 Granite 변경을 확인합니다.
- WebView SDK 3.x migration은 별도로 검토하고 React Native 컨슈머에 해당 config 또는 package
  변경을 적용하지 않습니다.
- React Native, React, Toss app minimum version이 바뀌었는지 확인합니다.
- Proxy 동작을 수정하기 전에 mTLS API integration process 변경을 확인합니다.
- Toss Login, IAP, promotion, Smart Message 문서의 request/response 또는 permission 변경을
  확인합니다.
- 메시지 template을 업데이트하기 전에 `requestNotificationAgreement`와 Smart Message 소개
  문서에서 기능성 메시지 동의 요건을 확인합니다.
- 비게임 앱 template을 업데이트하기 전에 TDS package guidance를 확인합니다.
- 앱 지원 SDK/runtime version policy를 올리기 전에 컨슈머 앱 smoke test를 실행합니다.

## RN SDK 호환성 매트릭스

CI는 kit 어댑터·클라이언트의 실제 소스와 타입 계약을 검토 기준 SDK와 선언된 최소
`@apps-in-toss/framework@2.10.10` 양쪽으로 컴파일합니다. 최소 버전은 개발 전용 npm
alias로 정확히 고정하고, `tsconfig.sdk-min.json`이 해당 타입 검사에서 SDK import를
최소 버전으로 연결합니다. `check-sdk-minimum.mjs`는 설치 버전·peer 하한·경로 매핑을
검증해 최소 버전 검사가 최신 버전 검사로 바뀌는 것을 막습니다. Renovate는 이 하한
fixture를 자동 갱신하지 않습니다.

`bun run packages:typecheck`, `bun run packages:typecheck:minimum`으로 실행하세요.
최소 지원 버전을 의도적으로 높일 때 peer 정책과 fixture를 함께 갱신합니다. Alias는
런타임 SDK 의존성이 아닙니다. 두 컴파일 성공은 검사한 두 버전의 타입 호환성을 뜻하며,
소비 앱에서 사용할 API별 가용성 검사와 실기기 검증은 유지하세요. 중간의 모든 버전,
기기, 네이티브 기능의 지원을 보장하지는 않습니다.
