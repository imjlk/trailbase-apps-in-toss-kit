# 컨슈머 AIT 릴리즈

`@trailbase-apps-in-toss-kit/release-tools`는 컨슈머의 Sampo 릴리즈와
앱인토스 업로드에 사용하는 빌드 도구입니다. 컨슈머의 Bun workspaces에
`vendor/trailbase-apps-in-toss-kit/packages/release-tools`를 추가하고,
릴리즈 스크립트가 있는 패키지에 `workspace:*` 개발 의존성을 추가하세요.
비공개 패키지이며 npm에 배포하지 않고 서브모듈로 사용합니다.

Sampo 탐색과 Cargo 잠금 파일 동기화는 **Bun 1.4.2 이상**에서 실행하세요.
이 기능은 `Bun.TOML.parse`를 사용합니다. AIT 전용 헬퍼는 Node에서도
실행됩니다. RN 앱 번들에서는 이 패키지를 import하지 마세요.

## Sampo 설정을 패키지 목록으로 사용

```js
import {
  readSampoLockstep, planSampoRelease, syncCargoLockVersions,
  createSampoReleaseTag,
} from '@trailbase-apps-in-toss-kit/release-tools/sampo';

const release = { root: process.cwd(), appName: 'your-app', anchor: 'npm/@your-app/rn' };
const lockstep = readSampoLockstep(release);
const plan = planSampoRelease(release);
```

anchor는 `.sampo/config.toml`의 fixed 그룹 하나를 선택합니다. 모든 구성원은
Git이 추적하는 `package.json` 또는 `Cargo.toml` 하나에 버전을 명시해야 하며,
안정 SemVer가 모두 같아야 합니다. 누락된 패키지나 Rust의 상속 버전은
검사에서 제외하지 않고 오류로 처리합니다. `vendor/`는 탐색에서 제외합니다.
워커, 작업 프로세스, 내부 crate까지 앱 전체를 Sampo 그룹에 포함하세요.

`plan.pending`이 true이면 Sampo 릴리즈 PR 자동화를 실행합니다. Sampo가
매니페스트를 갱신한 뒤 `syncCargoLockVersions(release)`와
`bun install --lockfile-only --ignore-scripts`를 실행하고 변경된 잠금 파일을
릴리즈 PR에 커밋하세요. Cargo 헬퍼는 **추적 중인 모든 Cargo.lock**에서
fixed 그룹의 로컬 패키지 버전을 갱신합니다. 레지스트리 패키지와 체크섬은
유지하며, 모호하거나 버전이 명시된 의존성 참조는 Cargo로 재생성해야 합니다.
의존성 업그레이드 자체를 해결하는 도구는 아닙니다.

검증된 릴리즈 PR을 머지한 뒤 전체 이력과 태그를 fetch하고 현재
`origin/main`을 checkout한 후 Git 작성자를 설정하세요. changeset이 없으면
`createSampoReleaseTag({ ...release, push: true })`가 깨끗한 checkout에서
`your-app-vX.Y.Z` 주석 태그를 만듭니다. 기존 태그는 이동하지 않습니다.
changeset 또는 해당 태그가 있으면 `plan.tag`는 빈 문자열입니다.

`/notes`의 `renderSampoReleaseNotes({ root, appName, lockstep })`는
패키지별 현재 버전 변경 기록을 합칩니다. 완전히 같은 항목만 중복 제거하며
서로 다른 여러 줄 마이그레이션 설명은 보존합니다. 기존
[미반영 changeset 초안](sampo-release-notes.md) 명령과 함께 사용하세요.

## 빌드 증거와 업로드

`/ait`는 `validatePublicBuildConfig`, `validateUploadRun`,
`readReleaseContext`, `inspectAitArtifact`, `buildConfigDigest`,
`validateReleaseEvidence`, `uploadVerifiedAit`를 제공합니다.

컨슈머에서 다음 순서를 구성합니다.

1. JSON 설정을 앱의 정확한 공개 설정 이름, 프로덕션 상수, HTTPS URL,
   필수·선택 광고 필드 정책으로 검증합니다. API 키는 이 객체와 번들러
   프로세스 환경에서 제외합니다.
2. Sampo 전체 그룹의 버전과 현재 Git 상태를 읽고 설치된 `ait` CLI로
   빌드합니다. 등록한 `appName`, 예상 JS 런타임·플랫폼 파일 목록, 공개
   `config`, 각 JS에서 확인할 `settingKeys`로 실제 `.ait` 바이트를 검사합니다.
3. Git 상태와 산출물 검사 결과, `configHash: buildConfigDigest(config)`,
   `fixture`, `uploaded: false`를 보고서로 저장합니다. PR용 fixture 빌드는
   업로드할 수 없습니다.
4. 업로드할 때 `requireTag: true`로 Git 상태를 새로 읽고 공개 설정도
   다시 읽습니다. `uploadVerifiedAit`에 `artifactPath`, 보고서, `context`,
   검사 `policy`, 설치된 `cliPath`, `appRoot`, `apiKey`를 전달합니다.
   태그는 앱·버전과 일치하고 HEAD를 가리켜야 하며, fetch한
   `origin/main`의 이력에 포함되어야 합니다. 성공하면 반환된 보고서를 저장하세요.

검사는 예상과 다른 런타임, 소스맵 누락, 포함된 테스트 광고 ID, 잘못된
설정, 압축 해제 후 100 MB 초과 번들을 거부합니다. 업로드 직전에 실제 파일의
해시·deployment ID, 소스 커밋, 버전, 태그, 설정 해시와 깨끗한 프로덕션 빌드
증거를 재확인하고 정확한 산출물 경로를 CLI에 전달합니다. CLI 실패 메시지에는
캡처한 출력과 비밀 인자를 노출하지 않습니다. 타임아웃이나 예상 밖 응답은
재시도 전에 콘솔을 확인해야 합니다. 로컬 보고서로 원격 업로드의 원자성을
보장할 수는 없습니다.

## 컨슈머 워크플로우의 책임

PR fixture와 태그 업로드 job을 분리하고 업로드 단계에만 앱인토스 키를
전달하세요. 수동 실행 기본값은 빌드만 수행하며, 명시적 업로드는 태그가
필요하고 fixture 모드를 거부합니다. 릴리즈 검증 코드 변경과 changeset을
기능 PR에 함께 넣어 Sampo가 정확한 릴리즈 PR을 생성하도록 하세요.

`GITHUB_TOKEN`으로 push한 태그는 후속 push 워크플로우를 실행하지 않습니다.
새 태그 생성 후 해당 태그에서 업로드 워크플로우를 명시적으로 dispatch하세요.
봇이 만든 릴리즈 PR에서 일반 검사가 실행되지 않으면 fixture를 dispatch하고,
검증한 정확한 SHA에 커밋 상태를 게시하세요. 브랜치 dispatch를 자동으로
PR 검사로 간주하면 안 됩니다. 업로드는 직렬화하고 산출물, 보고서, 실행 URL을
릴리즈 증거로 보관하세요.

헬퍼는 워크플로우 권한, 시크릿, GitHub Release, TrailBase 배포, 콘솔 제출,
실기기 테스트 승인을 생성하지 않습니다. 이 작업은 컨슈머가 관리합니다.
RN 런타임 지원은 명시적인 앱 정책이며, 헬퍼 추가로 WebView SDK 전환이
이뤄지지는 않습니다.

참고: [앱인토스 업로드와 테스트](https://developers-apps-in-toss.toss.im/guide/operation/toss),
[GitHub 워크플로우 트리거](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow).
