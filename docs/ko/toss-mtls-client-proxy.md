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

프록시 내부 구현은 이제 Toss endpoint 상수, 요청 정규화, stub 응답, Apps in Toss 어댑터
동작을 비공개 runtime-neutral workspace package인
`@trailbase-apps-in-toss-kit/toss-mtls-core`와
`@trailbase-apps-in-toss-kit/toss-mtls-client`에 위임합니다. 이는 구현 경계일 뿐입니다.
Docker 이미지, HTTP endpoint, 환경 변수, 응답 shape, 인증서 mount 모델은 그대로 유지됩니다.

Core package는 `apps-in-toss-community/oidc-bridge`에서 쓰는 형태와 호환되는 낮은 레벨의
mTLS client port를 사용합니다. 형태는 `request(url, init) => Response`이며, 향후 런타임을
위한 per-app client factory도 선택적으로 둘 수 있습니다. 이 kit는 OIDC 제품 레이어 아래에
머뭅니다. OIDC discovery, JWKS, `id_token` 발급, sealed refresh-token lifecycle,
Supabase/Firebase/Auth0 bridge 동작은 제공하지 않습니다.

프록시는 `SIGTERM`과 `SIGINT`를 받으면 HTTP 서버를 닫고 정상 종료합니다. 재사용 Compose
템플릿은 내부 서비스로 실행될 때 signal forwarding이 예측 가능하도록 `init: true`를 설정하고,
프록시의 기본 upstream timeout 및 IAP retry 설정에서 진행 중인 Toss 요청이 Docker에 의해
강제 종료되지 않도록 `stop_grace_period: 100s`를 설정합니다.
`MTLS_PROXY_UPSTREAM_TIMEOUT_MS`, `MTLS_PROXY_IAP_ORDER_STATUS_MAX_ATTEMPTS` 또는
`MTLS_PROXY_IAP_ORDER_STATUS_RETRY_DELAY_MS`를 늘린다면 그 shutdown budget에 맞게
`stop_grace_period`도 늘리세요. 운영 환경의 진행 중 요청 동작을 측정하기 전에는 로컬 피드백
속도만을 이유로 production `stop_grace_period`를 줄이지 마세요.

Docker Compose 또는 Coolify에서는
[`templates/trailbase/compose/toss-mtls-client-proxy.yml`](../../templates/trailbase/compose/toss-mtls-client-proxy.yml)을
복사하고 [coolify.md](coolify.md)를 함께 확인하세요. 이 템플릿은 포트 `8787`을 Compose
네트워크 안에서만 노출하므로, 같은 프로젝트의 어떤 백엔드도
`Authorization: Bearer <MTLS_PROXY_TOKEN>`와 함께 `http://toss-mtls-client-proxy:8787`로
호출할 수 있습니다.

## 최소 환경 변수

```text
MTLS_PROXY_MODE=stub|forward
MTLS_PROXY_TOKEN=...
MTLS_UPSTREAM_BASE_URL=https://apps-in-toss-api.toss.im
```

`MTLS_PROXY_TOKEN`은 `forward` 모드에서 필수입니다. `stub` 모드는 로컬 스모크 테스트를 위해
토큰 없이 실행할 수 있지만, 운영 배포에서는 항상 토큰을 설정해야 합니다. 이 값은 Toss가
발급하는 값이 아니라 앱이 소유하는 내부 bearer secret입니다. `openssl rand -hex 32` 같은 표준
CLI로 생성해서 배포 secret store에 저장하고, 커밋하지 마세요.

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
- `POST /internal/apps-in-toss/toss-login/remove-by-user-key`: Toss Login 연결 해제 어댑터.
- `POST /internal/apps-in-toss/iap/order/status`: 인앱 결제 주문 상태 어댑터.
- `POST /internal/apps-in-toss/promotion/reward/grant`: 프로모션 리워드 어댑터.
- `POST /internal/apps-in-toss/smart-message/send`: 스마트 메시지 어댑터.
- `POST /internal/apps-in-toss/smart-message/send-bulk`: 기능성 스마트 메시지 대량 발송 어댑터.
- `GET /internal/apps-in-toss/health`: 로컬 health/mode 확인.

## 백엔드 연동 계약

애플리케이션 백엔드는 프록시를 내부 HTTP 의존성으로 취급하면 됩니다.

```text
MTLS_PROXY_URL=http://toss-mtls-client-proxy:8787
MTLS_PROXY_TOKEN=replace-with-internal-proxy-token
```

`MTLS_PROXY_TOKEN`은 `openssl rand -hex 32`처럼 고엔트로피 난수로 생성하세요.

`MTLS_PROXY_TOKEN`이 설정되어 있다면 health check를 포함한 모든 프록시 요청에 아래 헤더를
붙여야 합니다.

```http
Authorization: Bearer <MTLS_PROXY_TOKEN>
```

JSON 본문이 있는 POST 요청에는 아래 헤더도 함께 붙이세요.

```http
Content-Type: application/json
```

최소 curl smoke 예시는 다음과 같습니다.

```bash
curl -sS "$MTLS_PROXY_URL/internal/apps-in-toss/health" \
  -H "Authorization: Bearer $MTLS_PROXY_TOKEN"
```

템플릿 smoke 스크립트는 다음처럼 사용할 수 있습니다.

```bash
templates/trailbase/scripts/toss-proxy-smoke.sh --health-only
templates/trailbase/scripts/toss-proxy-smoke.sh --full --expect-mode stub
```

운영 pre-QA에서는 내부 연결을 확인하고 health 응답이 기본적으로 `mode: "forward"`인지 검증하는
`--health-only`를 사용하세요. 가짜 어댑터 payload가 안전한 로컬 stub 환경에서만
`--full --expect-mode stub`을 사용합니다. 인자 없이 실행하면 health-only mode로 동작합니다.

최소 Node/Fetch 헬퍼는 다음과 같습니다.

```ts
const proxyUrl = process.env.MTLS_PROXY_URL ?? "http://toss-mtls-client-proxy:8787";
const proxyToken = process.env.MTLS_PROXY_TOKEN;

export async function callMtlProxy<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${proxyUrl}${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${proxyToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`mTLS proxy request failed: ${response.status}`);
  }
  return await response.json() as T;
}
```

어댑터별 요청 본문은 다음 형태를 사용합니다.

- Toss Login:

  ```json
  {
    "authorizationCode": "code-from-appLogin",
    "referrer": "SANDBOX"
  }
  ```

  forward 모드에서는 해석된 Toss `userKey`와 함께 `accessToken`, `refreshToken`,
  `tokenType`, `expiresIn` 같은 token metadata를 반환합니다. 이 token 필드는 backend-only
  secret으로 취급하세요. RN client, log, analytics, public table, audit metadata로 보내지
  마세요. 나중에 service-side 연결 해제를 지원하는 앱은 앱별 암호화/보존 정책에 맞춰 private
  identity storage에 token material을 보관하세요.

- `userKey`로 Toss Login 연결 해제:

  ```json
  {
    "tossUserKey": "toss-user-key",
    "accessToken": "toss-login-access-token"
  }
  ```

  이 어댑터는 공식 remove-by-user-key 요청을 Toss로 전달한 뒤, raw Toss `userKey`를 되돌려주지
  않고 `ok`, `providerStatus`, `resultType` 중심으로 응답을 정규화합니다. 내부 요청의
  `Authorization: Bearer <MTLS_PROXY_TOKEN>`는 proxy 인증용으로 계속 쓰고, Toss Login
  AccessToken은 JSON body에 넣어 주세요. proxy가 이를 Toss upstream의
  `Authorization: Bearer <AccessToken>` 헤더로 전달합니다.

- IAP 주문 상태:

  ```json
  {
    "orderId": "order-123",
    "tossUserKey": "toss-user-key"
  }
  ```

  로컬 상품 지급을 적용하기 전에 proxy 결과를 앱 소유 주문 원장에 저장하세요. TrailBase 앱은
  `templates/trailbase/sql/iap_orders.sql`과 `trailbase_guest_common::iap_orders`에서 시작할
  수 있습니다. [iap-orders.md](iap-orders.md)를 참고하세요.

- 프로모션 리워드 지급:

  ```json
  {
    "providerRequestId": "reward-20260610-001",
    "tossUserKey": "toss-user-key",
    "promotionCode": "PROMOTION_CODE",
    "amount": 50
  }
  ```

- 스마트 메시지 단건 발송:

  ```json
  {
    "providerRequestId": "message-20260610-001",
    "tossUserKey": "toss-user-key",
    "templateSetCode": "ORDER_READY",
    "context": {
      "userName": "Kim"
    }
  }
  ```

- 스마트 메시지 대량 발송:

  ```json
  {
    "providerRequestId": "message-bulk-20260610-001",
    "templateSetCode": "ORDER_READY",
    "contextList": [
      {
        "userKey": "toss-user-key-1",
        "context": {
          "userName": "Kim"
        }
      }
    ]
  }
  ```

- 일반 relay:

  ```json
  {
    "method": "POST",
    "path": "/api-partner/v1/apps-in-toss/messenger/send-message",
    "headers": {
      "content-type": "application/json"
    },
    "body": {
      "templateSetCode": "ORDER_READY",
      "context": {
        "userName": "Kim"
      }
    },
    "tossUserKey": "toss-user-key"
  }
  ```

앱에서 멱등성, 운영 감사, 재시도 추적이 필요하다면 앱의 ledger 또는 outbox에서 만든
`providerRequestId`를 사용하세요. 프록시는 같은 요청에서 JSON을 반환하며 애플리케이션 상태를
저장하지 않습니다.

스마트 메시지 어댑터는 `tossUserKey`를 `x-toss-user-key` 헤더로 전달하고 upstream JSON
본문에서는 제거합니다. Toss messenger 응답은 앱이 저장하기 쉬운
`providerStatus`, `resultType`, `msgCount`, `sentPushCount`, `sentInboxCount`, `detail`, `fail`,
`failureReason`, `failures[].reachFailReason` 필드로 정규화합니다. 하나 이상의 채널 발송에
성공한 부분 성공 응답은 `SENT`로 취급해서 잡이 이미 도달한 채널을 중복 발송하지 않게 합니다.
프록시는 알림 동의문을 요청하거나 검증하지 않습니다. 도입 앱은 필요한 경우 Apps in Toss
`requestNotificationAgreement` SDK를 호출하고, 동의 결과를 저장한 뒤 이 어댑터를 호출하기
전에 발송 가능 여부를 확인해야 합니다.

대량 발송 어댑터는 AppsInToss의
`/api-partner/v1/apps-in-toss/messenger/send-bulk-message`를 호출합니다. 같은
`templateSetCode`를 쓰는 기능성 메시지만 `contextList`로 묶고, 한 요청은 Toss 제한에 맞춰
최대 2,500명으로 유지하세요. 2,500명을 넘는 대상자는 도입 앱의 outbox/job이 다음 배치로
분할해서 호출해야 합니다.

프로모션 리워드 어댑터는 요청 본문(request body)에서 `promotionCode`와 `amount`를 받습니다.
`promotionAmount`도 호환 alias로 허용되지만, 새 호출자는 `amount`를 우선 사용하세요. 캠페인
필드가 생략되면 프록시는 환경 변수만 쓰는 기존 앱을 위해 `TOSS_PROMOTION_CODE`,
`TOSS_PROMOTION_AMOUNT`를 대체값(fallback)으로 사용합니다. 자체 캠페인 DB가 있는 앱은
요청마다 캠페인 값을 전달하고, 프록시는 사설 mTLS 경계(private mTLS boundary)로만 사용해야
합니다. Toss가 `4109`, `4112`, `4114`, `4116` 같은 오류 코드를 반환하면 상위 Toss 프로모션
오류 코드(upstream promotion error code)는 `providerErrorCode`로 정리됩니다.

DB 기반 캠페인에서는 `templates/trailbase/sql/promotion_campaigns.sql`을 도입 앱의
마이그레이션 묶음(migration set)으로 복사하세요. 새 앱은
`templates/trailbase/sql/promotion_reward_ledger.sql`에서 시작할 수 있고, 기존 앱은 자체 지급
원장(ledger)을 forward migration으로 맞추세요. 운영자가 환경 변수 파일(env file)에 프로모션
설정을 하드코딩(hard-code)하지 않고 캠페인을 일시 중지하거나 소진 처리할 수 있도록
`providerErrorCode` 값을 원장에 저장하세요. 앱 쪽 캠페인 및 지급 원장 패턴(ledger pattern)은
[promotion-campaigns.md](promotion-campaigns.md)를 참고하세요.

Toss Login 어댑터는 `appLogin()`이 반환한 `authorizationCode`와 `referrer`를 기대합니다. SDK
`referrer` 값은 그대로 전달하세요. 샌드박스 RN 빌드(sandbox RN build)에서는 이 값이
`SANDBOX`일 수 있고, 대소문자를 바꾸면 Toss가 1회용 인증 코드(one-time authorization code)를
`invalid_grant`로 거부할 수 있습니다.
TrailBase WASM 소비 앱은 프록시/forward 요청을 만들 때 자체 uppercase/lowercase 정규화를 하지
말고 `trailbase_guest_common::apps_in_toss_login::normalize_login_referrer`를 사용하세요.
proxy 모드에서 complete adapter는 나중에 service-side 연결 해제에 쓸 수 있도록 Toss token
metadata도 반환합니다. 이 metadata는 backend identity boundary 안에만 두고, 복호화가 필요한
형태로 저장해야 한다면 저장 전에 seal 처리하세요.

소비 앱 서버는 `referrer=SANDBOX`를 로컬 stub 신호로 취급하지 마세요. 실제 AppsInToss
샌드박스 앱에서 받은 `authorizationCode`도 서버에서 Toss Login 토큰 교환을 거쳐 실제 sandbox
`userKey`로 바뀌어야 합니다. 로컬 개발 편의를 위한 stub은 `TOSS_LOGIN_MODE=stub`처럼 명시적으로
켜거나, SDK가 없는 순수 시뮬레이터에서 앱이 만든 `dev-*` authorization code에만 제한하세요.
`TOSS_LOGIN_MODE=proxy` 또는 `forward`일 때는 `SANDBOX` referrer도 프록시/forward 경로로
보내야 프로모션, 스마트 메시지, 기능성 알림 QA에 사용할 수 있는 userKey가 저장됩니다.

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
