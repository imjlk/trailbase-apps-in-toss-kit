# Bootstrap 지연

WASM과 TrailBase가 같은 컨테이너에서 실행되면
`TRAILBASE_AUTH_BASE_URL=http://127.0.0.1:4000`을 로컬뿐 아니라 **운영** Compose에도
명시합니다. 클라이언트 링크용 `APP_BASE_URL`은 공개 주소로 유지합니다.
Coolify에 기존 값이 명시돼 있으면 Compose 기본값보다 우선하므로 배포 전에 확인합니다.
포트나 토폴로지가 다르면 실제 내부 주소를 지정합니다. 호스트 공개 포트와 컨테이너
리스너 포트를 혼동하지 않습니다.

공식 `/api/auth/v1/login`과 비밀번호 검증을 유지합니다.
`ensure_verified_auth_user_tx`로 기존 서비스 계정을 재사용하고 트랜잭션을 커밋한 뒤
`login_anonymous_auth_user_with_password_rotation`에 이전 비밀번호 시크릿을 전달합니다.
계정 연결이나 비밀번호 교체용 upsert까지 일괄 교체하지 않습니다. 신규 계정 해싱과
기존 계정 로그인 검증은 여전히 필요하며 성능을 이유로 우회하지 않습니다.

## 구간별 계측

Kit의 `trailbase_guest_common::bootstrap_timing::BootstrapTiming`을 사용합니다.
구버전에 고정된 앱은 `templates/trailbase/bootstrap_timing.rs`를 WASM 소스에 복사하고
`mod bootstrap_timing;`을 선언할 수 있습니다. 다른 Kit API나 의존성을 갱신할 필요는
없습니다. 복사본은 앱이 소유하며 이후 Kit 변경과 명시적으로 대조합니다.

```rust,ignore
let mut timing = BootstrapTiming::new(
    settings::string("TRAILBASE_BOOTSTRAP_TIMING").as_deref() == Some("true"),
);
// 본문 검증과 자격 증명 준비.
timing.transaction_starting();
let mut tx = db::tx()?;
timing.transaction_opened();
// 계정 확인 및 앱 상태 조회.
db::tx_commit(&mut tx)?;
timing.transaction_committed();
let tokens = login_anonymous_auth_user_with_password_rotation(/* ... */).await?;
timing.auth_finished();
// 응답 구성.
timing.succeeded();
```

별칭 계정을 포함한 모든 성공 분기를 계측합니다. 오류로 조기 반환해도 scope 종료 시
기록됩니다. **TrailBase 서비스**에 `TRAILBASE_BOOTSTRAP_TIMING=true`를 설정해 제한된
기간만 측정한 뒤 끕니다. 기본값은 off이며 활성화 시 요청당 stderr 한 줄을 남깁니다.
계정 식별자, 토큰, URL, 임의 오류 문자열을 받지 않고 분석/회계 DB에도 쓰지 않습니다.

시작 스크립트는 `TRAILBASE_BOOTSTRAP_TIMING`을 `"true"` 또는 `"false"` 문자열로 `/settings.json`에도 전달해야 합니다. WASM은 컨테이너 환경변수를 그대로 상속하지 않을 수 있으므로 JSON 작성 전 두 리터럴로 정규화합니다.

- `prepare_ms`: 트랜잭션 요청 전 본문 파싱과 준비.
- `transaction_open_ms`: 트랜잭션 획득 시간. 순수 잠금 대기 시간은 아닙니다.
- `transaction_ms`: 커밋을 포함한 DB 작업.
- `auth_ms`: HTTP 로그인 및 이전 시크릿 재시도/재해싱. 순수 네트워크 RTT가 아닙니다.
- `response_ms`: 로그인 후 scope 종료까지의 작업.
- `total_ms`: 위 구간 합계. 프록시 대기와 반환 후 전송은 제외합니다.
  `status=error`와 `last_stage`는 오류 내용 노출 없이 중단 위치를 구분합니다.

최초/반복/연결 계정/시크릿 교체 요청을 나눠 비슷한 운영 조건에서 p50/p95와 오류율을
비교합니다. 무관한 요청 시간을 빼거나 로컬 20ms를 운영과 같은 측정으로 보지 않습니다.
불필요한 작업은 줄이지만 실제 운영 개선은 배포 후 측정 전까지 미검증입니다.
인증 생략, 타 사용자 토큰 재사용, 해시 비용 축소, HTTP 중 트랜잭션 유지는 금지합니다.
