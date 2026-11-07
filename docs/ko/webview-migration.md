# React Native에서 WebView로 마이그레이션

kit은 이제 새 클라이언트 작업의 기준을 WebView SDK 3 경로(`@apps-in-toss/web-framework`와
`ait-web`)로 둡니다. 이 문서는 React Native 어댑터 지원 정책, 소비 앱에 남은 RN 사용처를
확인하는 방법, 기존 사용자·세션·서버 상태를 보존하는 단계별 전환 절차를 다룹니다.

## 지원 정책

- **`ait-rn`은 유지보수 모드입니다.** 버그, 보안 문제, `@apps-in-toss/framework` 2.x
  호환성, 전환 과정에서 상태를 옮기는 데 필요한 수정만 받습니다. 새 subpath나 RN 전용
  기능은 추가하지 않습니다.
- **새 클라이언트 헬퍼는 플랫폼 중립으로 먼저 만듭니다.** 공통 로직은 `ait-core`에 두고
  `ait-web`으로 노출합니다. `ait-rn`으로는 기존 RN subpath가 이미 그 개념을 가진 경우에만
  노출합니다. 앱 소유 엔드포인트만 호출하는 백엔드 클라이언트를 `ait-rn`에만 추가하지
  않습니다.
- **RN 소비 앱은 계속 동작합니다.** 소비 앱은 submodule revision을 고정하며, 소비 앱이
  RN 번들을 배포하는 동안에는 `ait-rn`을 workspace에 유지합니다. 제거는 마이그레이션 맵의
  모든 subpath에 WebView 경로가 생기고 소비 앱들이 WebView 전용 단계를 보고한 뒤에만
  changeset으로 알립니다.
- **앱별 전환은 되돌릴 수 없습니다.** SDK 3 번들을 출시한 뒤 SDK 2 번들로 롤백하는 것은
  지원되지 않습니다. 롤백이 아니라 앞으로 고치는(fix-forward) 계획을 세우세요.

공식 앱인토스 문서는 여전히 RN과 WebView 개발을 모두 안내합니다. 이 정책은 kit 자체의
선택입니다. SDK 3 WebView가 활발한 릴리스를 받고 있고, SDK 3는 SDK 로직을 서버로 옮겨
파트너 재배포 없이 토스가 수정을 반영할 수 있습니다. 팀에 RN 자체가 지원 종료됐다고
안내하기 전에 공식 문서를 확인하세요.

## 소비 앱 점검

소비 앱 저장소에서 권고용 점검 스크립트를 실행합니다.

```sh
node vendor/trailbase-apps-in-toss-kit/scripts/check-consumer-webview-migration.mjs --root .
```

`package.json`과 import 문만 읽습니다. 아무것도 import·설치·실행하지 않으며
`node_modules`, `vendor`, 빌드 산출물, 점(.)으로 시작하는 디렉터리는 건너뜁니다.
리포트에는 다음이 나옵니다.

- **Stage**: `rn-only`, `dual`(RN과 WebView 패키지가 나란히 있음), `webview-only`,
  `none` 중 하나입니다.
- **Footprint**: `ait-rn`, RN SDK, RN UI 패키지, `ait-web`, WebView SDK가 선언되거나
  import된 위치와 `granite.config.*`, `apps-in-toss.config.*` 위치입니다.
- **Items**: import한 `ait-rn` 이름별 조치이며 급한 것부터 보여 줍니다.
  - `blocked`: 이 kit revision에 완전한 WebView 대체가 없습니다. 부족한 부분과, 가능한
    경우 그동안 직접 호출할 SDK 3 API를 함께 보여 줍니다.
  - `rewrite`: `ait.login()` 같은 WebView 어댑터 API로 바꿉니다.
  - `swap-import`: 표시된 `ait-web` subpath에 같은 이름이 있습니다.
  - `review`: type 전용, namespace, 동적, 알 수 없는 import라서 직접 확인해야 합니다.

도구 연동에는 `--json`을 사용합니다. `--strict`(또는 `CI_STRICT=1`)는 `ait-rn`이나
`@apps-in-toss/framework` 사용처가 남아 있으면 실패합니다. RN 앱을 정리한 뒤 소비 앱
CI에서 켜 두면 RN import가 다시 들어오는 것을 막을 수 있습니다. 리포트는 정적 분석일
뿐이며 로그인·결제·광고·저장소 동작은 기기와 QR 테스트로 판단합니다.

점검 스크립트는 `data/webview-migration-map.json`을 읽습니다. `ait-web` 패키지 테스트가
이 맵을 정확하게 유지합니다. 모든 `ait-rn` runtime export가 분류되어야 하고, 같은 이름
항목은 WebView에 실제로 있어야 하며, pending 이름은 같은 이름의 WebView export가 생기는
즉시 테스트가 실패하므로 맵이 조용히 낡지 않습니다.

## 모듈 상태

이 kit revision 기준 상태입니다. 기준 원본은 맵 파일입니다.

| ait-rn subpath | WebView 경로 | 남은 부분 |
| --- | --- | --- |
| `ait-rn/ad-skip` | `ait-web/ad-skip` | 없음 |
| `ait-rn/ads` | `ait-web/ads` | 다시 내보내는 runtime 헬퍼(`runtime` 참고) |
| `ait-rn/analytics` | `ait-web/analytics` | 없음(`Analytics.log`, 명시적 `mapEvent`) |
| `ait-rn/engagement` | `ait-web/engagement` | 없음(문서 visibility로 구동) |
| `ait-rn/storage` | `ait-web/storage`, `ait.storage` | 없음 |
| `ait-rn/login` | `ait.login()` | 없음 |
| `ait-rn/identity` | `ait.createAnonymousKeyAuthCode()` | 없음(SDK 3.6+와 프록시 코드 교환 필요) |
| `ait-rn/haptics` | SDK 3 `generateHapticFeedback` | 없음(wrapper 계획 없음) |
| `ait-rn/notifications` | `ait.requestNotificationAgreement()` | 기능성 메시지 백엔드 클라이언트 |
| `ait-rn/iap` | `ait.purchase()`, `ait.subscribe()`, 주문 조회 | 대기 주문 복구 흐름, 지급 백엔드 클라이언트 |
| `ait-rn/share` | `ait.createShareLink()`, `ait.share()` | 메시지·딥링크·OG 이미지 헬퍼 |
| `ait-rn/inline-ads` | `ait-web/ads`의 `createWebViewBannerAds` | placeholder 결정 헬퍼 |
| `ait-rn/promotion` | 아직 없음 | 캠페인 지급 요청·상태 클라이언트 |
| `ait-rn/shopping` | 아직 없음 | 링크 정규화와 열기 bridge |
| `ait-rn/runtime` | 아직 없음 | 안전한 환경·플랫폼·버전·네트워크 헬퍼 |
| `ait-rn/diagnostics` | 아직 없음 | runtime 진단 수집기 |

남은 부분 대부분은 플랫폼 중립 코드(백엔드 클라이언트, 정규화 함수, placeholder 정책)라서
새로 작성하기보다 `ait-core`로 옮기는 편이 맞습니다.

## 단계별 전환

한 번에 앱 하나씩 옮깁니다. 각 단계는 그 자체로 배포 가능해야 합니다.

### 1. 목록 정리

점검 스크립트를 실행하고 `blocked` 항목부터 정리합니다. kit에 WebView 경로가 추가되기를
기다리거나, 리포트가 알려 주는 SDK 3 API를 앱 안에서 임시로 쓰고 나중에 kit 헬퍼로
바꿉니다. 화면 이전 방식도 정합니다. RN 컴포넌트와 TDS React Native는 React DOM과 TDS Web
패키지로 바뀌고, 도메인 로직은 두 앱이 함께 import하는 공유 workspace 패키지에 둡니다.

### 2. 백엔드 먼저, 이중 운영 기간

WebView 번들을 내보내기 전에 백엔드를 바꾸고, 아직 운영 중인 RN 번들과의 호환을
유지합니다.

- [Release Doctor](release-doctor.md) recipe로 프록시 capability
  `anonymous-key.exchange-auth-code`를 확인한 뒤, 새 코드를 한 번 교환하는 WebView
  bootstrap을 추가합니다. [익명 식별](anonymous-identity.md)에 따르면 교환된 키는 기존
  `ait:` HMAC seed와 계정 매핑을 그대로 유지합니다.
- RN 번들이 실행될 수 있는 동안에는 기존 RN bootstrap 경로를 켜 둡니다. WebView 경로를
  추가하는 릴리스에서 기존 경로를 함께 정리하지 않습니다.
- 실제로 관찰한 SDK 3 번들 origin과 로컬 개발 origin을 명시해 CORS를 설정합니다. RN은
  CORS가 필요 없었으므로 보통 이것이 첫 WebView 전용 백엔드 변경입니다.
  [WebView 어댑터](web-adapters.md)를 참고하세요.
- forward migration만 사용합니다. 운영 서비스를 교체하기 전에 모든 TrailBase 데이터베이스와
  depot, fresh-start 상태를 백업하고, 네트워크가 격리된 컨테이너에 복원해 업무 테이블의 행
  수와 내용 fingerprint를 비교합니다. 기존 볼륨은 연결된 채로 둡니다.

### 3. RN 앱 옆에 WebView 앱 만들기

WebView 앱을 `apps-in-toss.config.*`를 가진 별도 workspace 패키지로 추가합니다.
`@apps-in-toss/web-framework`는 소비 앱이 소유합니다. Bun workspaces에 `ait-web`,
`ait-core`, `trailbase-client`를 등록하고 SDK loader는 소비 앱 자신의 모듈에서 넘깁니다
([WebView 어댑터](web-adapters.md) 참고). 정리 단계 전까지 RN 앱은 회귀 기준으로 계속
빌드되게 둡니다.

### 4. 연속성 증명

기존 사용자가 체감하는 속성입니다. 하나씩 명시적으로 검증합니다.

- **식별**: RN 번들이 만든 익명 사용자와 토스 로그인 연결 사용자가 WebView bootstrap 뒤에도
  같은 TrailBase `_user`로 이어져야 합니다. 이전 서버 버전에서 RN 방식으로 계정을 만든 뒤
  WebView 경로로 bootstrap하는 백엔드 smoke 테스트로 확인합니다.
- **세션**: `ait.storage`는 키 앞에 `${appKey}.`를 붙이며 이는
  `createAppsInTossSessionStorage`가 쓰던 키와 같습니다. RN 앱이 직접 정한 키나 기본 리터럴
  키를 썼다면 `createAppsInTossSdkStorageBridge`로 그 키를 그대로 읽습니다. 저장된 세션을
  읽을 수 없으면 WebView 앱은 새 코드로 다시 인증해야 하며, 두 번째 계정을 만들거나
  클라이언트 hash로 대체하면 안 됩니다.
- **진행 중 작업**: 대기 중인 IAP 주문, 광고 스킵 요청 ID, 프로모션 intent는 서버에서
  정산됩니다. 저장 키와 요청 ID를 바꾸지 않아야 RN 번들이 시작한 작업을 WebView 번들이
  이어받습니다.
- **서버 기록**: 알림 동의, 토스 로그인 연결, 자체 재화 잔액과 원장은 서버에 있으므로 그대로
  넘어갑니다.

### 5. 검증

고정한 revision에서 kit 테스트를 실행하고, 소비 앱의 minified 번들을 빌드하고, 명시적인
SDK fixture로 브라우저 end-to-end 테스트를 실행합니다(기기 증거는 아닙니다). 그다음
백엔드 연속성 smoke와 iOS·Android 비공개 QR 테스트를 실행합니다. 로그인, 계정 전환, 결제와
복구, 광고, 알림 동의, 공유를 포함합니다.

### 6. 출시와 관찰

SDK 3 번들을 업로드하고 기존 경로와 RN 호환 테이블은 그대로 둡니다. bootstrap 실패와 중복
계정 신호를 관찰합니다. SDK 2 번들로 롤백하려 하지 말고 앞으로 고칩니다.

### 7. RN 경로 정리

RN 번들이 더 이상 사용자에게 제공될 수 없으면 기존 hash bootstrap 경로를 끕니다. 그다음
RN 앱, `@apps-in-toss/framework`, `ait-rn` workspace 항목을 제거하고 소비 앱 CI에서 점검
스크립트의 `--strict`를 켭니다.

## kit이 하지 않는 일

kit은 화면을 옮기거나 번들을 출시하거나 브라우저 localStorage를 복사하거나 기기 지원을
보증하지 않습니다. 공유 헬퍼, 마이그레이션 맵과 점검 스크립트, 이 runbook 규칙을
제공합니다. UI 이전, 백엔드 이중 운영 기간, 기기 검수는 각 소비 앱이 책임집니다.
