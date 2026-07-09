# Apps in Toss 업스트림 추적

이 저장소는 Apps in Toss 서비스를 위한 TrailBase 통합 kit입니다. Apps in Toss React Native
SDK, Granite runtime, TDS package를 vendoring하지 않습니다. 해당 dependency는 컨슈머 앱이
소유하며, 앱 단위 smoke test 이후에만 업데이트해야 합니다.

## 공식 업스트림 소스

- Release notes: https://developers-apps-in-toss.toss.im/release-note.md
- LLM index: https://developers-apps-in-toss.toss.im/llms.txt
- React Native tutorial: https://developers-apps-in-toss.toss.im/tutorials/react-native.md
- SDK overview: https://developers-apps-in-toss.toss.im/bedrock/reference/framework/시작하기/intro.md
- API overview: https://developers-apps-in-toss.toss.im/api/overview.md
- mTLS integration process: https://developers-apps-in-toss.toss.im/development/integration-process.md
- Toss Login: https://developers-apps-in-toss.toss.im/login/develop.md
- In-app purchase: https://developers-apps-in-toss.toss.im/iap/develop.md
- Promotion: https://developers-apps-in-toss.toss.im/promotion/develop.md
- Smart Message: https://developers-apps-in-toss.toss.im/smart-message/develop.md
- Smart Message overview and notification agreement policy: https://developers-apps-in-toss.toss.im/smart-message/intro.md
- Notification agreement SDK: https://developers-apps-in-toss.toss.im/bedrock/reference/framework/인터렉션/requestNotificationAgreement.md
- Non-game user identity key: https://developers-apps-in-toss.toss.im/bedrock/reference/framework/비게임/getAnonymousKey.md
- TDS React Native docs: https://tossmini-docs.toss.im/tds-react-native/

## 호환성 정책

- 컨슈머 SDK, Granite, TDS package version은 앱이 소유합니다.
- 업스트림 추적만을 위해 이 kit의 runtime dependency에 `@apps-in-toss/framework`,
  `@granite-js/react-native`, TDS package를 추가하지 않습니다.
- 저장소 root는 lockfile/reference 검증을 위해 `@apps-in-toss/framework`를 dev dependency로
  고정할 수 있지만, publish/private kit package는 Apps in Toss SDK package를 peer 또는
  주입 dependency로 유지해야 합니다.
- React Native 비게임 mini-app의 익명 TrailBase principal seed는 Apps in Toss
  `getAnonymousKey()`의 `{ type: "HASH", hash }` 결과를 기준으로 합니다.
- 랜덤 local hash나 `createAnonymousHash()` 결과는 local/dev/test fallback이며 production
  identity seed가 아닙니다.
- 비게임 mini-app은 TDS를 반드시 사용해야 합니다. 게임에서는 TDS가 선택 사항입니다.
- 신규 React Native mini-app은 Granite 용어와 framework 1.0 이상을 기준으로 합니다.
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
- `apps-in-toss-framework`: `2.10.4`

<!-- renovate: datasource=npm depName=@toss/tds-react-native versioning=npm -->
- `tds-react-native`: `2.0.3`

<!-- renovate: datasource=npm depName=create-granite-app versioning=npm -->
- `create-granite-app`: `1.0.36`

<!-- renovate: datasource=npm depName=@granite-js/react-native versioning=npm -->
- `granite-js-react-native`: `1.0.36`

- `@toss-design-system/react-native`: framework 1.0 이전 프로젝트에서 쓰던 legacy package
  name입니다. 초기 tracking snapshot 시점에는 public npm `latest` metadata를 확인할 수
  없었으므로 신규 앱의 활성 reference로 사용하지 않습니다.

이 Renovate marker block이나 `renovate.json`을 수정했다면 `bun run renovate:validate`로
설정을 검증하세요. 업스트림 snapshot PR이 SDK package 변경을 감지하면 release note를
검토하고 root reference dependency, lockfile, 이 marker를 같은 후속 PR에서 함께 맞추세요.
Snapshot script는 의도적으로 감지만 담당합니다. Snapshot, root `package.json`, 영문/국문
tracking marker가 일치하는지는 `bun run apps-in-toss:tracking:check`로 확인합니다.

## 최근 검토한 SDK 변경

저장소 reference는 `@apps-in-toss/framework` `2.10.4`까지 검토했습니다.

- `2.8.0`: 비게임 내비게이션 바 테마 설정 기능이 추가되었습니다.
- `2.9.0`: 앱 번들 배포 명령어에 `ait deploy --timeout` 옵션이 추가되었습니다.
- `2.9.2`: 게임 앱에서 Toss 앱 내비게이션 바의 X 버튼을 누르면 종료 확인 모달이 표시됩니다.
  비게임 앱은 기존처럼 바로 종료됩니다.
- `2.10.1`: Metadata 검증용 Apps in Toss reference package family를 갱신합니다.
  컨슈머 앱은 도입 전에 업스트림 SDK release note를 검토하고 앱 단위 smoke test를 실행해야
  합니다.
- `2.10.4`: Metadata 검증용 Apps in Toss framework reference와 Granite package family를
  갱신합니다. 공유 kit API 변경은 필요하지 않습니다.

이 SDK 변경으로 공유 kit API를 바꿀 필요는 낮아 보입니다. 다만 컨슈머 앱의 지원 Apps in Toss
SDK/runtime policy는 앱 단위 smoke test 이후에만 올리세요.

## Doc Watch 출력물

`Apps in Toss doc watch` workflow는 업스트림 snapshot을 아래 경로에 씁니다.

- `data/upstream/apps-in-toss/docs-snapshot.md`
- `data/upstream/apps-in-toss/docs-snapshot.json`

Snapshot은 문서 hash와 npm reference package metadata를 저장합니다. 업스트림 문서 전문을 이
저장소에 복사하지 않습니다.

Workflow는 현재 upstream watch PR token으로 `TRAILBASE_RELEASE_WATCH_TOKEN`을 재사용합니다.
이 token은 생성된 PR이 downstream `pull_request` check를 트리거할 수 있도록 이 저장소에
branch push와 pull request 생성 권한이 있어야 합니다.

## Apps in Toss 변경 리뷰 체크리스트

- Release notes에서 SDK 2.x, Granite, 필수 migration 변경을 확인합니다.
- React Native, React, Toss app minimum version이 바뀌었는지 확인합니다.
- Proxy 동작을 수정하기 전에 mTLS API integration process 변경을 확인합니다.
- Toss Login, IAP, promotion, Smart Message 문서의 request/response 또는 permission 변경을
  확인합니다.
- 메시지 template을 업데이트하기 전에 `requestNotificationAgreement`와 Smart Message 소개
  문서에서 기능성 메시지 동의 요건을 확인합니다.
- 비게임 앱 template을 업데이트하기 전에 TDS package guidance를 확인합니다.
- 앱 지원 SDK/runtime version policy를 올리기 전에 컨슈머 앱 smoke test를 실행합니다.
