# 기기 및 SDK 진단

Kit은 [공식 미니앱 테스트 절차](https://developers-apps-in-toss.toss.im/guide/operation/toss)를 보완합니다. WebView 검사기를 새로 추가하거나 로컬 테스트로 실기기 성공을 추정하지 않습니다.

## RN 런타임 정보

```ts
import { collectAppsInTossRuntimeDiagnostics } from '@trailbase-apps-in-toss-kit/ait-rn/diagnostics';
const report = await collectAppsInTossRuntimeDiagnostics({ enabled: debugEnabled });
```

기본은 꺼짐입니다. 명시적으로 켰을 때만 실행 환경, OS, 토스 버전, 네트워크를 조회하며 각 조회는 3초로 제한합니다. 미확인·실패·시간초과를 구분합니다. 정해진 상태 값과 숫자형 버전만 반환하고 실행 URL, 사용자 식별자, 토큰, 네이티브 오류 원문이나 SDK 인자는 포함하지 않습니다. `deviceFeaturesVerified`는 항상 false입니다. 소비 앱이 디버그 UI나 콘솔 표시를 선택하며 원격 전송은 기본 제공하지 않습니다.

호출별 시간과 SDK 실패 분류는 별도 버전으로 관리되는 AIT Kit의 `createSdkDiagnostics` 릴리즈 후 사용합니다. `run()`은 호출을 재시도하거나 취소하지 않습니다. 이 런타임 정보 수집기는 현재 배포된 `@ait-kit/sdk` 0.5.1과 호환되며 미배포 API를 import하지 않습니다.

## WebView 통신 사전 검사

Release Doctor의 선택형 `webview-network` 검사 예시입니다.

```json
{
  "checks": [{
    "type": "webview-network", "runtime": "web", "appName": "your-app",
    "sdkVersion": "3.7.0", "endpoint": "https://api.your-service.example/api/read",
    "method": "POST", "requestHeaders": ["authorization", "content-type"]
  }]
}
```

기존 `trailbase-release-doctor --config <file>`로 실행합니다. OPTIONS만 보내고 응답 본문을 읽거나 리다이렉트를 따라가지 않으며 쿠키·인증값도 전송하지 않습니다. 정확한 origin과 명시적으로 허용된 요청 헤더를 검사합니다. GET/HEAD/POST는 Fetch의 CORS-safelisted 메서드 규칙을 따르며 PUT/PATCH/DELETE는 메서드의 명시적 허용이 필요합니다. CORS 설정 자체는 수정하지 않습니다. 실제 콘솔 origin이나 미지원 미래 SDK 버전은 `origins`를 명시하세요. 기본 버전 매핑은 [버전별 공식 안내](https://developers-apps-in-toss.toss.im/guide/operation/toss)를 따릅니다. `runtime: rn`은 CORS 검사를 건너뛰며 RN 통신 성공의 증거가 아닙니다. fixture용 `allowLocalHttp: true`는 loopback만 허용합니다. 각 요청에 시간 제한이 있으며 preflight 성공은 실제 인증/API/실기기 SDK 검증과 구분합니다.

## 테스트 스킴과 검증 기록

`release-tools/device-test`의 `createDeviceTestScheme`, `createDeviceTestPlan`에 콘솔/CLI가 발급한 스킴과 실제 번들에서 확인한 deployment ID를 전달합니다. 발급된 host·deployment ID를 유지하며 경로 크기와 query 키를 제한하고 민감한 키 이름은 거부합니다. 합성·공개 fixture 값만 사용하고 인증정보를 넣지 마세요. 계획에는 앱·버전·커밋·번들 해시를 기록하며 모든 항목은 `not_run`으로 시작합니다. 번들 업로드, 기기 실행, 검증 완료 처리는 자동 수행하지 않습니다. 출시 전 테스트에 `intoss://`를 받지 않습니다.

경로별 query를 추가해도 발급된 스킴의 기존 `queryParams`는 유지합니다. 같은 키를 지정했을 때만 새 값으로 덮어씁니다. 기존 값과 새 값 모두 검증하며, 합친 query에 크기 제한을 적용합니다.

## SDK 버전과 Sentry

RN 기준 fixture는 2.10.11로 올리고 기존 최소 2.10.10 검사도 유지합니다. 새 진단이 신규 네이티브 API를 요구하지 않기 때문입니다. 소비 앱은 framework/native-modules를 함께 올린 뒤 로컬·실기기로 검증합니다. Kit 신규 API는 Sampo changeset으로 기록하며 기준 fixture 갱신만으로 peer 최소 버전을 올리지 않습니다.

Sentry는 소비 앱이 선택합니다. [공식 RN 안내](https://developers-apps-in-toss.toss.im/ai-vibe-coding/integration/sentry)에 따라 `enableNative: false`, Granite 플러그인 `useClient: false`, 실제 deployment에 대한 소스맵 업로드가 필요합니다. 이 변경은 Sentry 초기화나 업로드를 하지 않습니다.

`inspectAitDeviceMetadata(bytes)`로 실제 AIT 파일의 앱 이름, deploymentId, SHA256을 읽은 뒤 콘솔이 발급한 scheme과 대조합니다.
