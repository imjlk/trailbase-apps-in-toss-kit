# Kit 참조 환경 검증과 증거

고정한 Bun·Rust 도구와 Docker가 있는 커밋된 checkout에서 실행합니다.

```sh
bun install --frozen-lockfile
bun scripts/run-kit-reference.mjs --output /tmp/kit-reference.json
```

일회용 Docker 컨테이너·비공개 네트워크·임시 SQLite depot와 합성 SDK·제공사 fixture를
사용합니다. 소비 앱 경로를 읽거나 서비스를 배포하거나 실제 토스 결제·운영 인증서를
사용하지 않습니다. `Kit reference evidence` workflow는 참조 환경 변경 시 실행되며
릴리즈 전 수동 실행도 지원합니다. 비공개 값을 제외한 JSON artifact를 30일 보관합니다.

보고서에는 소스 커밋, lockfile SHA-256, 설치된 Bun·Node·Rust·RN 최소/현재·Web SDK 버전,
관찰한 서버·프록시 image ID, 검사별 결과·시간, 브라우저 번들 크기와 로컬 측정값을
기록합니다. 프록시는 소스로 빌드한 stub임을 명시하므로 미출시 변경이 GHCR 배포 버전에
포함됐다는 증거가 아닙니다. 검증 중 소스 변경, 추적하지 않은 소스 파일, 커밋 변경은
성공을 막습니다. Finder 메타데이터와 요청한 보고서 파일은 소스 검사에서 제외합니다.
선언된 runtime bin 파일은 실행 권한을 유지해 workspace 연결 후에도 깨끗한 상태를 유지합니다.

## 검증하는 경로

- 공통 Rust·JS 테스트 및 실제 RN 최소/현재 SDK와 Web SDK 타입.
- 앱 자체 보상과 기능 중단 정책을 포함한 전체 기능 원장 SQL 마이그레이션.
- 실제 WASM의 익명 stub 검증, 공식 TrailBase 로그인·갱신, 인증·CSRF 경계,
  비공개 Record API ACL과 SSE 변경 이벤트.
- 서버 보상 발급, 한 번의 로컬 지급과 영수증 재조회. 정상/외부 중단 모드를 분리하며
  중단 모드에는 실제 수행한 거절 검사만 기록합니다.
- 실제 WASI 난수 nonce, 기존 v1·이전 v2 읽기, 같은 트랜잭션의 재암호화 cursor·암호문
  저장, 재시도 no-op, HMAC·업무 시각 유지와 철회된 삭제 표시 보존.
- Runtime 테스트의 과거 백업 이력 차이 격리·원래 ID 대사, 공통 API fixture와 계정·세션
  생명주기 테스트.
- RN을 포함하지 않는 모듈 그래프 확인과 Web 어댑터 브라우저 컴파일.

암호화 fixture는 `trailbase-toss-identity`의 별도 일회용 WASM example입니다. 두 호환성
guest 모두 소비 앱에 설치하지 마세요. 비공개 식별자와 cursor는 임시 DB 안에만 두고
fixture endpoint는 boolean과 건수만 반환합니다. 합성 키는 테스트 입력이며 운영 설정 예제가 아닙니다.

## 측정값 해석

`bun scripts/reference/benchmark.mjs`는 합성 5,000행에서 실제 비공개 IAP 진단 조회를,
샘플당 이벤트 2,000개에서 공통 SSE parser를 측정합니다. 워밍업 후 샘플 수와 p50/p95
경과 시간을 밀리초로 보고합니다. 로컬 메모리 내 측정이며 assertion도 측정 작업에
포함됩니다. 운영 지연·처리량 보장이나 소비 앱의 네트워크·기기·제공사 벤치마크가 아닙니다.
기기마다 달라지는 통과 기준은 없으며 성능 퇴행을 확인할 때는 같은 fixture 규모·도구
버전·실행 환경끼리 비교하세요. 번들 크기는 분리된 chunk를 포함한 압축 전 바이트입니다.

생성된 Sampo 릴리즈 PR 검토에 소스·이미지·버전 증거를 사용하세요. 성공한 검증이 릴리즈
게시, TrailBase 최소 버전 상향, 기능 활성화, 키 폐기, 복구 작업 재개를 승인하지는 않습니다.
소비 앱 QR·기기 검사, 실제 mTLS 준비 상태, 운영 복원 절차와 수동 호환성 정책은 별도
증거가 필요합니다. 실패 보고서도 보관하며 `ok: false`를 검증 완료로 취급하지 않습니다.
