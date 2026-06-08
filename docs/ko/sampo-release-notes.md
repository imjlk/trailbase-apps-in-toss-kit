# Sampo 릴리스 노트

Sampo changeset은 이 kit의 package changelog와 운영자용 릴리스 노트의 원천 자료입니다.
각 changeset은 패키지 작성자만이 아니라 컨슈머 앱 maintainer가 읽을 수 있는 문장으로
작성하세요.

## Changeset을 추가할 때

아래처럼 downstream 서비스가 체감할 수 있는 변경에는 changeset을 추가합니다.

- Rust WASM helper API, auth flow helper, DB helper 동작, SQL template.
- TypeScript client/runtime API 또는 시작 동작.
- mTLS proxy request/response 동작, 환경 변수, retry 정책, image runtime 전제.
- 배포, migration, 보안, 호환성, 운영 가이드.

릴리스되는 package나 운영 workflow를 바꾸지 않는 내부 문서, 주석, 테스트, CI-only 변경에는
보통 changeset을 추가하지 않습니다.

## 릴리스 노트 문장 작성 기준

Changeset 본문은 그대로 릴리스 노트 초안으로 재사용될 수 있습니다.

- 사용자가 체감하는 결과를 먼저 씁니다.
- 운영자가 알아야 하는 migration, env var, secret, image tag, smoke test, rollback note를
  명시합니다.
- 구현 세부사항은 호환성 위험을 설명할 때만 남깁니다.
- 컨슈머 smoke test가 끝나기 전에는 컨슈머 호환성을 보장한다고 쓰지 않습니다.
- raw secret, Toss 식별자, 실제 log, 인증서 데이터, production 전용 URL은 넣지 않습니다.

예시:

```md
---
cargo/trailbase-guest-common: minor
npm/@trailbase-apps-in-toss-kit/toss-mtls-client-proxy: patch
---

Add shared promotion reward validation helpers and proxy retry controls. Apps
that copied the promotion SQL template should reconcile the new index before
raising their supported kit version.
```

## 로컬에서 릴리스 노트 초안 만들기

대기 중인 `.sampo/changesets/*.md` 파일에서 Markdown 초안을 생성합니다.

```bash
bun run sampo:release-notes:draft
```

PR, GitHub Release 본문, 내부 handoff note를 준비할 때 파일로 저장할 수도 있습니다.

```bash
bun run sampo:release-notes:draft -- --output RELEASE_NOTES_DRAFT.md
```

초안에는 changeset별 highlights, package impact 섹션, 원본 changeset 경로, 간단한 검토
체크리스트가 들어갑니다. 이 파일은 작성 보조 도구입니다. package version bump와 package
changelog 업데이트의 기준은 생성된 Sampo 릴리스 PR입니다.

## 컨슈머 저장소에서 사용하기

컨슈머 앱은 kit submodule을 통해 초안 스크립트를 재사용할 수 있습니다.

```bash
node vendor/trailbase-apps-in-toss-kit/scripts/draft-sampo-release-notes.mjs --root .
```

컨슈머 changeset 디렉터리가 `.sampo/changesets`가 아니라면 명시적으로 넘깁니다.

```bash
node vendor/trailbase-apps-in-toss-kit/scripts/draft-sampo-release-notes.mjs \
  --root . \
  --changesets .sampo/changesets \
  --output RELEASE_NOTES_DRAFT.md
```

컨슈머 앱에서 보이는 동작은 컨슈머 changeset에 기록합니다. Kit submodule pointer update만으로는
컨슈머 changeset이 꼭 필요하지 않습니다. 다만 그 업데이트가 runtime 동작, 복사한 template,
배포 절차, 사용자 경험을 바꾸면 컨슈머 changeset으로 남기세요.

## 릴리스 흐름

1. `sampo add`로 changeset을 추가하거나 기존 changeset을 검토합니다.
2. `bun run sampo:release-notes:draft`로 초안을 만들고 대상 독자에 맞게 다듬습니다.
3. 다듬은 문장을 PR summary, release issue, GitHub Release body, 내부 rollout note에 옮깁니다.
4. Changeset이 포함된 기능 PR을 머지합니다. `Sampo release` workflow가 대기 중인 changeset으로
   `release/main` 릴리스 PR을 열거나 갱신합니다.
5. 릴리스 PR의 changelog와 package version을 검토한 뒤 머지하거나 image release automation에
   의존하세요.

## 에이전트 지침

일반적인 릴리스 노트 초안 작업에는 repo 전용 새 agent skill이 필요하지 않습니다. Sampo
changeset, release, publish, bot 작업에는 공통 `$sampo` skill을 사용하세요. 릴리스 노트가
TrailBase migration, Record API 노출, WASM auth 동작, 배포, production reset, mTLS 인증서
처리를 건드릴 때만 `trailbase-ops`를 함께 사용합니다.
