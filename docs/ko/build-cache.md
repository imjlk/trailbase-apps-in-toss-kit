# Rust와 Docker 빌드 캐시 공유

Kit 소스는 특정 커밋에 고정된 Git 서브모듈로 유지하고, 다시 만들 수 있는 빌드 산출물을
공유합니다. 아래 설정은 선택적으로 적용합니다. Kit가 셸 프로필, Docker 전역 설정,
소비자 스크립트나 기존 캐시를 자동 변경하지 않습니다.

## 로컬 Cargo 빌드

신뢰할 수 있는 소비자 저장소들이 호환되는 도구 체인을 사용한다면 개발자 셸이나 앱의
로컬 실행기에 공용 절대 경로를 설정합니다. 소비자 workspace에서 해당 앱이 사용하는 Rust
도구 체인으로 실행하며, 검사 전에 활성 도구 체인에 필요한 WASI target을 설치합니다.

```sh
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-${XDG_CACHE_HOME:-$HOME/.cache}/ait-kit/cargo-target/$(uname -s)-$(uname -m)}"
rustup target add wasm32-wasip2
cargo check --locked --target wasm32-wasip2
```

기존 CARGO_TARGET_DIR 설정은 우선합니다. XDG_CACHE_HOME을 설정한다면 절대 경로를 사용합니다.
이것은 셸 예제이며 `.env`나 Cargo TOML에 그대로 붙이는 값이 아닙니다. 해당 파일은 위 셸
표현식을 확장하지 않습니다. 설정은 현재 셸의 자식 프로세스에만 전달되며 Docker, 다른 터미널,
IDE에 자동 적용되지 않습니다. Cargo의 명시적 `--target-dir`이 우선하므로 공용 경로를 도입할
때만 기존의 충돌하는 설정을 조정합니다.

적용 전 다음을 확인합니다.

- `target/`을 가정하는 복사 스크립트와 Docker COPY를 찾습니다. 빌드와 같은 환경·manifest로
  `cargo metadata --format-version 1 --no-deps`를 실행해 실제 target 경로를 읽거나 Cargo JSON의
  `compiler-artifact`에서 정확한 산출물 경로를 가져옵니다.
- 빌드 직후 앱별 staging 경로에 필요한 산출물을 복사합니다. 이름이 같은 최상위 바이너리는
  서로 덮어쓸 수 있으므로 공용 target을 릴리즈 보관소로 사용하지 않습니다.
- 동시 빌드 일부는 Cargo 잠금 때문에 대기할 수 있습니다. 경합이 크거나 서로 신뢰하지 않는
  저장소라면 target 경로를 분리합니다.
- 도구 체인·기능·프로필·대상 차이로 별도 산출물이 생깁니다. 공유만으로 중복 제거 또는 용량
  제한이 보장되지는 않습니다.
- 공용 경로에 무조건 `cargo clean`을 실행하면 다른 앱 캐시도 삭제될 수 있습니다. 사용하는
  빌드가 모두 멈춘 뒤 점검·정리합니다. 기존 앱별 target은 자동 이동하거나 삭제하지 않습니다.

참고: [Cargo 빌드 캐시](https://doc.rust-lang.org/cargo/reference/build-cache.html).

## Kit 로컬 실행기와 점검 도구

Kit에서는 `node scripts/cargo-local.mjs -- <cargo 명령>`을 사용합니다. 오래된 소비자는
독립 파일인 `scripts/cargo-local.mjs`와 `scripts/cargo-cache-report.mjs`를 앱 소유 `scripts/`에
복사할 수 있습니다. 관련 없는 런타임 서브모듈 코드를 올리지 않고 빌드 도구만 채택하기 위한
방식이며, 도구 업데이트 시 복사본을 대조합니다. 새 소비자는 서브모듈 스크립트를 직접 호출해도
됩니다. Node와 PATH에 설정된 Cargo/rustup이 필요합니다. 호출한 디렉터리와 도구 체인을 유지하며
Rust 설치나 전역 mise/rustup 설정 변경은 하지 않습니다. mise shim에 Rust 버전이 없다면 프로젝트
버전을 먼저 지정하거나 설치된 rustup proxy 디렉터리를 PATH에 넣습니다.

```sh
node scripts/cargo-local.mjs -- check --locked --workspace --target wasm32-wasip2
node scripts/cargo-local.mjs --ephemeral -- test --locked --workspace
node scripts/cargo-local.mjs --full-debug -- test --locked --workspace
node scripts/cargo-local.mjs -- target-dir --manifest-path apps/trailbase/wasm/Cargo.toml
node scripts/cargo-cache-report.mjs /absolute/checkouts /absolute/shared-cache
```

기본 target은 위 OS/아키텍처별 경로와 같습니다. 기존 `CARGO_TARGET_DIR`과 Cargo `--target-dir`이
우선합니다. dev/test 디버그 정보는 기본 `line-tables-only`로 파일·줄 번호 추적은 남기고 상세 변수
정보를 줄입니다. `--full-debug`는 workspace/환경의 원래 디버그 설정을 그대로 사용합니다. release
프로필은 변경하지 않습니다. `--ephemeral`은 일회성 검사에서 incremental을 기본으로 끄며, 기존
프로필/incremental 환경 설정은 항상 우선합니다. 실행한 프로세스 밖의 환경을 변경하지 않습니다.

`target-dir`은 같은 환경에서 Cargo metadata의 실제 target 경로를 출력합니다. 빌드와 같은
manifest·옵션으로 경로를 확인하고 성공 직후 필요한 WASM을 staging에 복사합니다. 기존 체크아웃의
`target/`에서 오래된 파일을 읽거나 공용 최상위 파일을 릴리즈 보관소로 사용하지 않습니다.
실행기는 직접 `clean` 호출을 거부하며, 의도적인 정리는 별도로 Cargo를 사용합니다.

JSON 점검 도구는 Cargo 마커를 확인하고 하위 심링크·node_modules·로컬 실행 데이터를 제외하며
`du -sk` 블록 추정치를 합산합니다. 읽기 전용이며 미사용 여부를 증명하지 않고 공유 파일시스템
블록 때문에 합계가 겹칠 수 있습니다. 지정한 기존 target을 지우기 전 Cargo/rustc 프로세스와
산출물 사용처를 확인하고 필요한 파일을 보존하며 대체 빌드를 검증합니다. 수정 시각만으로 삭제하거나
심링크를 따라 정리하거나 TrailBase 볼륨을 포함하지 않습니다.

Docker 기본 주소 풀이 소진된 경우 Kit WASM smoke는 `KIT_SMOKE_SUBNET`으로 충돌 여부를 확인한 미사용 테스트 subnet을 받을 수 있습니다. 자체 네트워크만 생성·정리하며 소비자 네트워크를 재사용하거나 삭제하지 않습니다.

## Docker 빌드

WASM이라도 빌드 스크립트와 procedural macro는 빌드 호스트에서 실행되므로 Mac의 target과
Linux builder 캐시는 분리합니다. 소비자 `.dockerignore`에서 `**/target`, `**/node_modules`,
실행 데이터인 `traildepot`, 비밀 파일과 릴리즈 산출물을 제외합니다. 빌드에 필요한 템플릿
migration과 Kit 서브모듈 소스는 포함해야 합니다.

Cargo registry/git 다운로드와 컴파일에는 BuildKit cache mount를 사용합니다. 캐시 ID는
신뢰 범위·도구 체인·빌드 플랫폼으로 나누며 매번 소스 커밋을 붙이지 않습니다. 동시 빌드에서는
Cargo 잠금 파일을 포함한 캐시 경로를 `sharing=locked`로 마운트합니다. 인증 정보나 호스트의
Cargo home 전체는 공유하지 않습니다. 다음은 기존 빌드 단계에 적용할 예시이며 경로·도구 체인
namespace·패키지 산출물 이름은 소비자에 맞춥니다.

```dockerfile
# syntax=docker/dockerfile:1
# wasm32-wasip2 지원을 설치한 기존 Rust 빌드 단계 내부:
ARG BUILDPLATFORM
ARG RUST_CACHE_NAMESPACE=rust-toolchain-v1
RUN --mount=type=cache,id=ait-cargo-${RUST_CACHE_NAMESPACE}-${BUILDPLATFORM},target=/cargo-cache,sharing=locked \
    --mount=type=cache,id=ait-target-${RUST_CACHE_NAMESPACE}-${BUILDPLATFORM},target=/cargo-target,sharing=locked \
    CARGO_HOME=/cargo-cache CARGO_TARGET_DIR=/cargo-target \
    cargo build --locked --release --target wasm32-wasip2 \
    && mkdir -p /out \
    && cp /cargo-target/wasm32-wasip2/release/your_api.wasm /out/api.wasm
```

Rust 도구 체인이나 빌드 환경을 변경할 때 namespace도 바꿉니다. 런타임 단계에는
`/out/api.wasm`을 복사합니다. cache mount 내용은 이미지 레이어 산출물이 아닙니다.
빈 캐시에서도 빌드가 성공해야 합니다. 이 예제는 완전한 앱 Dockerfile이나 target 설치를
대체하지 않습니다.

## 사용량 점검과 용량 관리

```sh
docker context show
docker buildx ls
docker system df -v
docker buildx du --builder YOUR_BUILDER
```

로컬 빌드 또는 Coolify가 실제 사용하는 builder를 선택합니다. builder와 서버가 다르면
캐시도 별개입니다. 예를 들어 8GB부터 시작해 디스크 여유와 재빌드 빈도에 맞춥니다.
이 수치는 파일시스템의 강제 용량 할당량이 아닙니다.

- `docker` 드라이버: 기존 daemon 설정에
  [docker-daemon-gc.example.json](../../templates/trailbase/build-cache/docker-daemon-gc.example.json)의
  `builder.gc` 부분을 병합합니다. Docker Desktop에서는 Settings → Docker Engine입니다.
- 호환되는 별도 BuildKit OCI worker:
  [buildkitd-gc.example.toml](../../templates/trailbase/build-cache/buildkitd-gc.example.toml)을
  builder 설정에 병합합니다. 설치된 BuildKit 버전을 확인하며 JSON과 TOML을 혼용하지 않습니다.
  기존 사용자 정의 GC 정책은 별도 검토합니다. 재시작은 유지보수 시간에 적용합니다.

사용량 확인 후 다음 명령은 선택한 builder에서 7일 이상 사용하지 않은 빌드 캐시를 정리합니다.

```sh
docker buildx prune --builder YOUR_BUILDER --filter 'until=168h'
```

미리보기 명령이 아닙니다. 확인 질문을 유지하고 광범위한 정리를 기본 자동화로 등록하지
않습니다. 정리 후 다음 빌드에서 의존성 다운로드·재컴파일이 발생할 수 있습니다. GC는 미사용
이미지·중지 컨테이너·볼륨 전체를 관리하지 않습니다. 별도로 점검하고 운영 및 롤백 이미지의
digest를 보존합니다. TrailBase 데이터 볼륨은 빌드 캐시 정리에 포함하지 않습니다.
이 작업에 `docker system prune --volumes`나 `docker compose down -v`를 사용하지 않습니다.
로컬 Cargo 산출물은 BuildKit GC 관리 대상이 아닙니다.

참고: [Docker 캐시 최적화](https://docs.docker.com/build/cache/optimize/),
[빌드 GC](https://docs.docker.com/build/cache/garbage-collection/).
