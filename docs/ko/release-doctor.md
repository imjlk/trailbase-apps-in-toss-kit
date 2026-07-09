# Release Doctor

Release doctor는 preQA와 릴리스 체크리스트를 한 번에 실행하기 위한 작은 오케스트레이션
헬퍼입니다. 공통 TrailBase 안전 점검과 앱이 소유한 명령을 하나의 정규화된 결과 형식으로
묶어 실행할 수 있습니다.

릴리스 후보, 운영 배포, 스모크 테스트 handoff 전에 실행해야 하는 점검에 사용하세요. 제품별
정책은 도입 서비스에 유지하고, kit는 재사용 가능한 check 배관과 공통 TrailBase 점검만
제공합니다.

## CLI

운영 env 파일 하나만 검증하려면 다음처럼 실행합니다.

```bash
node vendor/trailbase-apps-in-toss-kit/packages/trailbase-runtime/bin/release-doctor.mjs \
  --env-file apps/trailbase/.env.production \
  --app-env-key APP_ENV
```

JSON config를 실행할 수도 있습니다.

```bash
node vendor/trailbase-apps-in-toss-kit/packages/trailbase-runtime/bin/release-doctor.mjs \
  --config apps/trailbase/release-doctor.json
```

CI가 정규화된 결과를 읽어야 한다면 `--json`을 추가하세요.

## Config 형태

운영 env 검증, 복사된 템플릿 차이 확인, 릴리스 노트 확인을 한 번에 묶는 시작점이 필요하면
템플릿을 복사하세요.

```bash
cp vendor/trailbase-apps-in-toss-kit/templates/trailbase/release/release-doctor.config.example.json \
  apps/trailbase/release-doctor.json
```

이 템플릿은 복사된 파일이 `apps/trailbase/release-doctor.json`에 있다고 가정하고,
명령형 check가 repository root에서 실행되도록 `"root": "../.."`를 설정합니다. CI나
릴리스 체크리스트에서 사용하기 전에 경로와 앱별 env key를 조정하세요.

```json
{
  "root": "../..",
  "checks": [
    {
      "type": "production-env",
      "name": "Production env",
      "file": "apps/trailbase/.env.production",
      "appEnvKey": "APP_ENV",
      "optionalHttps": ["APP_BASE_URL", "TRAILBASE_PUBLIC_URL"]
    },
    {
      "type": "command",
      "name": "Template drift",
      "command": "bun",
      "captureOutput": "failure",
      "timeout": 300000,
      "required": false,
      "args": [
        "vendor/trailbase-apps-in-toss-kit/scripts/compare-consumer-templates.mjs",
        ".",
        "--strict",
        "--summary"
      ]
    },
    {
      "type": "changeset",
      "name": "Pending Sampo changeset",
      "required": false
    }
  ]
}
```

상대 경로는 config 파일이 있는 디렉터리를 기준으로 해석합니다. Config 파일이 repository
root보다 아래에 있지만 명령은 repository root에서 실행해야 한다면 `root`를 추가하세요.

지원하는 check type은 다음과 같습니다.

- `production-env`: 공통 운영 env 검증기를 실행합니다.
- `command`: 앱이 소유한 명령을 실행하고 기본적으로 exit code `0`을 성공으로 봅니다. 명령 출력은 기본적으로 실패 시에만 캡처하며, `captureOutput`을 `always` 또는 `none`으로 바꿀 수 있습니다. `timeout` 기본값은 300,000 ms입니다.
- `changeset`: `.sampo/changesets/*.md` 대기 changeset이 있는지 확인합니다.

`"required": false`를 설정하면 실패한 check를 전체 실패가 아니라 경고로 보고합니다.
템플릿은 복사된 파일과 릴리스 프로세스를 정리한 뒤에 strict 정책으로 올리는 경우가 많아서,
템플릿 차이와 changeset check를 기본적으로 경고로 둡니다.

## JavaScript 헬퍼

커스텀 규칙이 필요한 스크립트는 같은 헬퍼를 import할 수 있습니다.

```js
import {
  createCommandCheck,
  createProductionEnvCheck,
  runReleaseDoctor,
} from "@trailbase-apps-in-toss-kit/trailbase-runtime/release-doctor";

const summary = await runReleaseDoctor({
  checks: [
    createProductionEnvCheck({
      file: "apps/trailbase/.env.production",
      appEnvKey: "APP_ENV",
    }),
    createCommandCheck({
      name: "Smoke",
      command: "bun",
      args: ["run", "smoke"],
    }),
  ],
});

process.exit(summary.ok ? 0 : 1);
```

명령 인자나 출력에 secret을 넣지 마세요. Doctor는 실패 맥락을 위해 명령 출력을 짧게
보관하는 것이 기본값이지만, 앱이 소유한 명령도 token, certificate, raw Toss identifier,
HMAC, sealed value를 출력하지 않아야 합니다.
