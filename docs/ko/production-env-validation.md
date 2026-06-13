# 운영 환경 변수 검증

운영 환경 변수 검증(production env validation)은 두 층으로 나눕니다. 여러 TrailBase
AppsInToss 서비스에 공통으로 필요한 안전 규칙은 kit가 맡고, 제품마다 다른 정책은 각 앱이
맡습니다.

이 검증은 로컬 셸, CI, 운영 배포(production deployment) 전에 실행하세요. 자리표시자
secret(placeholder secret), 로컬 URL, 움직이는 이미지 태그, 실수로 남은 fresh-start 설정처럼
리뷰에서 놓치기 쉬운 문제를 잡기 위한 장치입니다.

공통 런타임 검증기는 다음 규칙을 다룹니다.

- secret 값을 확장하지 않고 dotenv 형식 파일을 파싱합니다.
- 필수 값과 비밀값(secret)으로 취급해야 하는 값을 요구합니다.
- 자리표시자 값(placeholder)과 로컬 개발용 값을 거부합니다.
- 공개 URL에는 HTTPS를 요구합니다.
- 제한값과 timeout은 양의 정수인지 확인합니다.
- `TRAILBASE_FRESH_START_*` 의미를 검증합니다.
- `TRAILBASE_SYNC_CONFIG`를 검증합니다.
- 운영 환경에서 `TRAILBASE_DEV_ADMIN_*`가 켜지는 것을 막습니다.
- `latest`, `edge`처럼 움직이는 mTLS 프록시 이미지 태그를 거부합니다.
- `MTLS_PROXY_*`와 `COMPOSE_PROFILES` 조합을 검증합니다.
- 로컬 또는 마운트된 mTLS 인증서 디렉터리에 사용할 수 있는 cert/key 쌍이 있는지 선택적으로
  검증할 수 있습니다.

각 앱은 앱 고유의 key와 정책을 검증하는 얇은 래퍼 스크립트(wrapper script)를 유지해야 합니다.
예를 들어 게임은 리워드나 인벤토리 설정이 필요할 수 있고, 다른 앱은 Toss Login과 IAP만
필요할 수 있습니다.

## 책임 분리

- kit는 TrailBase AppsInToss 서비스 전반에 공통인 규칙을 검증합니다.
- 앱은 제품 고유 변수와 정책 결정을 검증합니다.
- 배포 도구는 해당 환경에서 어떤 env 파일이 운영용인지 결정합니다.

## 움직이는 이미지 태그

운영 환경에서는 정확한 SemVer 태그를 사용하세요. 의도적으로 범위를 넓히고 싶을 때만 minor
SemVer 태그를 사용할 수 있습니다.

```text
ghcr.io/imjlk/trailbase-apps-in-toss-kit/toss-mtls-client-proxy:0.1.6
ghcr.io/imjlk/trailbase-apps-in-toss-kit/toss-mtls-client-proxy:0.1
```

움직이는 태그(moving tag)는 의도적인 테스트와 CI 워크플로(workflow)용입니다.

```text
edge
latest
```

## TrailBase 서버 이미지 참고 진단

TrailBase 서버 이미지는 이 kit가 아니라 각 도입 앱이 소유합니다. 도입 앱이 특정 버전을 고정하고
스모크 테스트까지 마쳤다면 업스트림 최신보다 낮은 서버 버전을 의도적으로 운영할 수 있습니다.

선택 사항인 참고 진단 스크립트는 도입 앱의 Compose 파일, 이미지 태그, 명시 버전을 검사할 수
있습니다.

```bash
node vendor/trailbase-apps-in-toss-kit/scripts/check-trailbase-version-policy.mjs \
  --compose docker-compose.yml
```

도입 앱이 kit의 수동 호환성 정책을 강제할 준비가 되었을 때만 `CI_STRICT=1`을 사용하세요. Kit
minimum supported와 last verified TrailBase version이 선언되기 전까지 이 스크립트는 정보 제공
용도로 동작합니다.

예시 파일은 `--allow-placeholders`로 검증할 때 placeholder를 사용할 수 있습니다. 실제 운영
env 파일에는 placeholder, 로컬 URL, 개발용 토큰, 움직이는 이미지 태그가 남아 있으면 안
됩니다.

## Fresh Start 규칙

Fresh start는 토큰(token)과 확인 값(confirmation value)이 함께 있을 때만 데이터를 지울 수
있어야 합니다. 토큰만 있다고 데이터를 초기화하면 안 됩니다. 같은 토큰을 다시 사용하더라도
표시 파일(marker)이 이미 기록되어 있으면 다시 초기화하지 않아야 합니다.

각 앱은 confirmation 변수 이름을 문서화해야 합니다. 공통 검증기는 이 패턴을 확인할 수
있지만, 특정 환경에서 fresh start를 허용할지는 앱이 결정합니다.

## 규칙 확장

앱별 래퍼는 공통 검증기를 import하고, 앱 고유 규칙을 작은 함수로 추가하는 방식이 좋습니다.
CI, 로컬 셸, 배포 runbook에서 모두 쓸 수 있도록 출력은 사람이 읽기 쉽고 항상 같은 형식으로
유지하세요.

운영 검증에서 프록시 인증서 디렉터리를 볼 수 있다면 `mtlsCertificatePairDir`를 넘겨 검증할 수
있습니다. 이 디렉터리는 Toss Console 파일 쌍(`*_public.crt`와 같은 prefix의
`*_private.key`) 하나 또는 `client-cert.pem`과 `client-key.pem`을 포함해야 합니다.
