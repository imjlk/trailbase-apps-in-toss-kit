# Toss mTLS 클라이언트 프록시

`toss-mtls-client-proxy`는 내부 클라이언트 프록시(internal client proxy)입니다. 공개
콜백(callback) 서버가 아닙니다. TrailBase는 Compose 내부 네트워크에서 프록시를 호출하고,
프록시는 Toss로 나가는(outbound) mTLS 연결을 엽니다. 응답은 같은 요청에서 돌아오므로
프록시에 공개 인입 경로(public ingress)가 필요하지 않습니다.

이 컨테이너는 TrailBase 밖에서도 재사용할 수 있습니다. Node, Rails, Spring, Go, FastAPI 같은
백엔드가 같은 사설 네트워크에서 프록시로 인증된 HTTP 요청을 보낼 수 있다면, mTLS 인증서를
애플리케이션 컨테이너 밖에 둔 채 같은 프록시를 사용할 수 있습니다.

백엔드가 클라이언트 인증서(client certificate)가 필요한 Toss API를 호출해야 할 때 이 프록시를
사용하세요. Toss가 앱으로 보내는 공개 콜백에는 사용하지 마세요. 그런 콜백은 앱 백엔드에서
직접 받아야 합니다.

## 실행 모델

- 이미지는 공개되어도 됩니다.
- 실행 중인 인스턴스는 내부 네트워크에서만 접근되어야 합니다.
- 인증서 파일은 프록시 컨테이너에만 마운트(mount)합니다.
- 애플리케이션 서비스는 내부 프록시 URL과 `MTLS_PROXY_TOKEN`만 받습니다.
- 운영 배포(production deployment)에서는 의도한 경우가 아니라면 `latest` 또는 `edge`가 아닌
  정확한 SemVer 또는 minor tag로 이미지를 고정합니다.

가장 중요한 경계는 인증서 소유권입니다. 인증서 파일은 프록시 컨테이너만 마운트합니다.
애플리케이션 컨테이너는 내부 URL과 Bearer 토큰만 받습니다.

## 최소 환경 변수

```text
MTLS_PROXY_MODE=stub|forward
MTLS_PROXY_TOKEN=...
MTLS_UPSTREAM_BASE_URL=https://apps-in-toss-api.toss.im
```

`MTLS_PROXY_TOKEN`은 `forward` 모드에서 필수입니다. `stub` 모드는 로컬 스모크 테스트를 위해
토큰 없이 실행할 수 있지만, 운영 배포에서는 항상 토큰을 설정해야 합니다.

인증서는 다음 순서로 찾습니다.

1. `MTLS_CERT_DIR` 아래의 단일 Toss Console 파일 쌍:
   `*_public.crt`, `*_private.key`.
2. `MTLS_CLIENT_CERT_PATH`, `MTLS_CLIENT_KEY_PATH`의 명시적 대체 경로(fallback path).
3. `MTLS_CERT_DIR` 아래의 일반 대체 파일명.

```text
/run/mtls/*_public.crt
/run/mtls/*_private.key
/run/mtls/client-cert.pem
/run/mtls/client-key.pem
/run/mtls/ca-cert.pem
```

`MTLS_CERT_DIR` 기본값은 `/run/mtls`입니다. 일반적인 Coolify 설정에서는 Toss Console에서 받은
`*_public.crt`, `*_private.key` 파일을 `mtls_client_certs` 볼륨(volume)에 복사하면 됩니다.
파일별 경로 환경 변수(path env)는 필요하지 않습니다. 볼륨에 완전한 쌍이 정확히 하나 있지
않으면 프록시는 `MTLS_CLIENT_CERT_PATH`, `MTLS_CLIENT_KEY_PATH`를 대체 경로로 사용합니다.
`MTLS_CA_CERT_PATH`는 선택 사항이며 파일이 있을 때만 읽습니다.

선택적으로 설정할 수 있는 안전 제한값은 다음과 같습니다.

```text
MTLS_PROXY_REQUEST_BODY_LIMIT_BYTES=1048576
MTLS_PROXY_UPSTREAM_BODY_LIMIT_BYTES=2097152
MTLS_PROXY_UPSTREAM_TIMEOUT_MS=15000
MTLS_PROXY_IAP_ORDER_STATUS_MAX_ATTEMPTS=6
MTLS_PROXY_IAP_ORDER_STATUS_RETRY_DELAY_MS=350
MTLS_PROXY_DEBUG=false
```

IAP 주문 상태 어댑터(order-status adapter)는 `ORDER_IN_PROGRESS`, `PAYMENT_PENDING`,
`NOT_FOUND` 같은 일시적인 제공자 상태(provider state)를 재시도합니다. 방금 생성된 sandbox
order가 Toss에서 조회 가능해질 짧은 시간을 주기 위한 동작입니다.

## API

- `POST /internal/mtls/request`: 일반 mTLS JSON relay.
- `POST /internal/apps-in-toss/toss-login/complete`: Toss Login 어댑터.
- `POST /internal/apps-in-toss/iap/order/status`: 인앱 결제 주문 상태 어댑터.
- `POST /internal/apps-in-toss/promotion/reward/grant`: 프로모션 리워드 어댑터.
- `POST /internal/apps-in-toss/smart-message/send`: 스마트 메시지 어댑터.
- `GET /internal/apps-in-toss/health`: 로컬 health/mode 확인.

스마트 메시지 어댑터는 `tossUserKey`를 `x-toss-user-key` 헤더로 전달하고 upstream JSON
본문에서는 제거합니다. Toss messenger 응답은 앱이 저장하기 쉬운
`providerStatus`, `resultType`, `msgCount`, `sentPushCount`, `sentInboxCount`, `detail`, `fail`,
`failureReason`, `failures[].reachFailReason` 필드로 정규화합니다. 하나 이상의 채널 발송에
성공한 부분 성공 응답은 `SENT`로 취급해서 잡이 이미 도달한 채널을 중복 발송하지 않게 합니다.

프로모션 리워드 어댑터는 요청 본문(request body)에서 `promotionCode`와 `amount`를 받습니다.
`promotionAmount`도 호환 alias로 허용되지만, 새 호출자는 `amount`를 우선 사용하세요. 캠페인
필드가 생략되면 프록시는 환경 변수만 쓰는 기존 앱을 위해 `TOSS_PROMOTION_CODE`,
`TOSS_PROMOTION_AMOUNT`를 대체값(fallback)으로 사용합니다. 자체 캠페인 DB가 있는 앱은
요청마다 캠페인 값을 전달하고, 프록시는 사설 mTLS 경계(private mTLS boundary)로만 사용해야
합니다. Toss가 `4109`, `4112`, `4114`, `4116` 같은 오류 코드를 반환하면 상위 Toss 프로모션
오류 코드(upstream promotion error code)는 `providerErrorCode`로 정리됩니다.

DB 기반 캠페인에서는 `templates/trailbase/sql/promotion_campaigns.sql`을 도입 앱의
마이그레이션 묶음(migration set)으로 복사하고, 자격 판정과 리워드 지급 원장(ledger)은 앱별로
유지하세요. 또한 운영자가 환경 변수 파일(env file)에 프로모션 설정을 하드코딩(hard-code)하지
않고 캠페인을 일시 중지하거나 소진 처리할 수 있도록 `providerErrorCode` 값을 원장에 저장하세요. 앱 쪽
캠페인 및 지급 원장 패턴(ledger pattern)은 [promotion-campaigns.md](promotion-campaigns.md)를
참고하세요.

Toss Login 어댑터는 `appLogin()`이 반환한 `authorizationCode`와 `referrer`를 기대합니다. SDK
`referrer` 값은 그대로 전달하세요. 샌드박스 RN 빌드(sandbox RN build)에서는 이 값이
`SANDBOX`일 수 있고, 대소문자를 바꾸면 Toss가 1회용 인증 코드(one-time authorization code)를
`invalid_grant`로 거부할 수 있습니다.

일반 relay는 다음 모양의 JSON 본문(body)을 받습니다.

```json
{
  "method": "POST",
  "path": "/relative/upstream/path",
  "headers": {
    "content-type": "application/json"
  },
  "body": {},
  "tossUserKey": "optional-user-key-header-value"
}
```

`path`는 전체 URL(full URL)이 아니라 `/`로 시작하는 상대 경로여야 합니다. `forward` 모드에서
프록시는 이를 `MTLS_UPSTREAM_BASE_URL`과 합치고, 마운트된 인증서 파일로 Toss에 나가는 mTLS
요청(outbound mTLS request)을 연 뒤,
`{ "ok": boolean, "status": number, "headers": object, "body": unknown }`을 반환합니다.

요청과 응답 형태가 앱에 맞으면 AppsInToss 어댑터 엔드포인트(adapter endpoint)를 사용하세요.
다른 Toss mTLS API는 일반 relay를 사용하거나, 반복적인 정리나 여러 단계 흐름(multi-step flow)
처리가 필요한 API에는 작은 어댑터를 추가하세요.
