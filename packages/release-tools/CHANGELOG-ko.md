# @trailbase-apps-in-toss-kit/release-tools

## 0.4.1 — 2026-10-16

### 패치 변경

- [087bc87](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/087bc871094e5cb624923813e966f90f2747666d) Windows에서 shell 없이 JavaScript AIT CLI 진입 파일을 실행할 수 있습니다. `.cmd` shim 대신 설치된 CLI의 실제 `.js`, `.mjs`, `.cjs` 파일을 `cliPath`로 전달하세요. 아티팩트 경로·API 키의 인자 경계를 유지하고 업로드 오류에서 자격 증명과 CLI 출력을 계속 숨깁니다. 릴리즈 의존성 검사에서는 같은 Windows 저장소의 짧은 경로와 긴 경로를 동일하게 인식하며 하위 디렉터리와 의존성 변경은 계속 거부합니다. — @imjlk의 기여입니다.

이전 변경 이력은 [영어 원문](CHANGELOG.md)을 참고하세요.
