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
- TDS React Native docs: https://tossmini-docs.toss.im/tds-react-native/

## 호환성 정책

- 컨슈머 SDK, Granite, TDS package version은 앱이 소유합니다.
- 업스트림 추적만을 위해 이 kit의 runtime dependency에 `@apps-in-toss/framework`,
  `@granite-js/react-native`, TDS package를 추가하지 않습니다.
- 비게임 mini-app은 TDS를 반드시 사용해야 합니다. 게임에서는 TDS가 선택 사항입니다.
- 신규 React Native mini-app은 Granite 용어와 framework 1.0 이상을 기준으로 합니다.
- Framework 1.0 이상에서는 `@toss/tds-react-native`를 사용합니다. Legacy framework에서는
  `@toss-design-system/react-native`를 사용했습니다.
- mTLS API 변경은 proxy와 서버 연동 표면에 영향을 줍니다. Login, IAP, promotion,
  Smart Message 동작을 함께 검토하세요.

## Renovate가 추적하는 reference version

<!-- renovate: datasource=npm depName=@apps-in-toss/framework versioning=npm -->
- `apps-in-toss-framework`: `2.6.0`

<!-- renovate: datasource=npm depName=@toss/tds-react-native versioning=npm -->
- `tds-react-native`: `2.0.3`

<!-- renovate: datasource=npm depName=create-granite-app versioning=npm -->
- `create-granite-app`: `1.0.28`

<!-- renovate: datasource=npm depName=@granite-js/react-native versioning=npm -->
- `granite-js-react-native`: `1.0.28`

- `@toss-design-system/react-native`: framework 1.0 이전 프로젝트에서 쓰던 legacy package
  name입니다. 초기 tracking snapshot 시점에는 public npm `latest` metadata를 확인할 수
  없었으므로 신규 앱의 활성 reference로 사용하지 않습니다.

이 Renovate marker block이나 `renovate.json`을 수정했다면 `bun run renovate:validate`로
설정을 검증하세요.

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
- 비게임 앱 template을 업데이트하기 전에 TDS package guidance를 확인합니다.
- 앱 지원 SDK/runtime version policy를 올리기 전에 컨슈머 앱 smoke test를 실행합니다.
