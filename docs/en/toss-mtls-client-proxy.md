# Toss mTLS Client Proxy

`toss-mtls-client-proxy` is an internal client proxy. It is not a public callback server. TrailBase
can call it over the Compose internal network, and the proxy opens outbound mTLS connections to Toss.
Responses return on the same outbound request, so the proxy does not need public ingress.

The container is reusable outside TrailBase. A Node, Rails, Spring, Go, FastAPI, or other backend can
run it on the same private network, send authenticated HTTP requests to the proxy, and keep mTLS
certificates out of the application container.

Use the proxy when the backend needs to call Toss APIs that require client
certificates. Do not use it for public callbacks from Toss to your app; those
callbacks should terminate at the app backend.

## Runtime Model

- Image may be public.
- Instance should be internal-only.
- Certificate files are mounted into the proxy container only.
- Application services receive only the internal proxy URL and `MTLS_PROXY_TOKEN`.
- Production deployments should pin the image to an exact SemVer or minor tag, not `latest` or
  `edge`, unless moving tags are intentional.

The most important boundary is certificate ownership: only the proxy container
mounts certificate files. Application containers receive an internal URL and a
bearer token.

Internally, the proxy delegates Toss endpoint constants, request normalization, stub responses, and
Apps in Toss adapter behavior to the public runtime-neutral packages `@ait-kit/api-core` and
`@ait-kit/api-client`. This is an implementation boundary only. The Docker image, HTTP endpoints,
environment variables, response shapes, and certificate mount model remain the same.

The core package uses a low-level mTLS client port compatible with the shape used by
`apps-in-toss-community/oidc-bridge`: `request(url, init) => Response`, plus an optional per-app
client factory for future runtimes. This kit stays below the OIDC product layer: it does not provide
OIDC discovery, JWKS, `id_token` issuance, sealed refresh-token lifecycle, or Supabase/Firebase/Auth0
bridge behavior.

The proxy handles `SIGTERM` and `SIGINT` by closing its HTTP server and exiting cleanly. The reusable
Compose template sets `init: true` so signals are forwarded predictably when the container runs as an
internal service, and `stop_grace_period: 100s` so Docker does not kill valid in-flight Toss requests
under the proxy's default upstream timeout and IAP retry settings. If you raise
`MTLS_PROXY_UPSTREAM_TIMEOUT_MS`, `MTLS_PROXY_IAP_ORDER_STATUS_MAX_ATTEMPTS`, or
`MTLS_PROXY_IAP_ORDER_STATUS_RETRY_DELAY_MS`, raise `stop_grace_period` with that shutdown budget.
Do not lower production `stop_grace_period` solely for faster local feedback until you have measured
in-flight request behavior for your deployment.

For Docker Compose or Coolify, copy
[`templates/trailbase/compose/toss-mtls-client-proxy.yml`](../../templates/trailbase/compose/toss-mtls-client-proxy.yml)
and read [coolify.md](coolify.md). The template exposes port `8787` only on the Compose network, so
any backend in the same project can call `http://toss-mtls-client-proxy:8787` with
`Authorization: Bearer <MTLS_PROXY_TOKEN>`.

## Minimal Environment

```text
MTLS_PROXY_MODE=stub|forward
MTLS_PROXY_TOKEN=...
MTLS_UPSTREAM_BASE_URL=https://apps-in-toss-api.toss.im
```

`MTLS_PROXY_TOKEN` is required in `forward` mode. Stub mode can run without a token for local smoke
tests, but production deployments should always set one. This is an app-owned internal bearer secret,
not a Toss-issued value. Generate one with a standard CLI such as `openssl rand -hex 32` and store it
in the deployment secret store; do not commit it.

Certificates are resolved in this order:

1. A single Toss Console file pair under `MTLS_CERT_DIR`:
   `*_public.crt` and `*_private.key`.
2. Explicit fallback paths from `MTLS_CLIENT_CERT_PATH` and `MTLS_CLIENT_KEY_PATH`.
3. Generic fallback names under `MTLS_CERT_DIR`.

```text
/run/mtls/*_public.crt
/run/mtls/*_private.key
/run/mtls/client-cert.pem
/run/mtls/client-key.pem
/run/mtls/ca-cert.pem
```

`MTLS_CERT_DIR` defaults to `/run/mtls`. In the normal Coolify setup, copy the Toss Console
`*_public.crt` and `*_private.key` files into the `mtls_client_certs` volume and no per-file path env
is needed. If the volume does not contain exactly one complete pair, the proxy falls back to
`MTLS_CLIENT_CERT_PATH` and `MTLS_CLIENT_KEY_PATH`. The default `MTLS_CA_CERT_PATH` fallback is loaded
only when the file exists. If you set `MTLS_CA_CERT_PATH` explicitly, the proxy fails closed when that
file is missing or unreadable.

Optional safety limits:

```text
MTLS_PROXY_REQUEST_BODY_LIMIT_BYTES=1048576
MTLS_PROXY_UPSTREAM_BODY_LIMIT_BYTES=2097152
MTLS_PROXY_UPSTREAM_TIMEOUT_MS=15000
MTLS_PROXY_IAP_ORDER_STATUS_MAX_ATTEMPTS=6
MTLS_PROXY_IAP_ORDER_STATUS_RETRY_DELAY_MS=350
MTLS_PROXY_DEBUG=false
```

The IAP order-status adapter retries transient provider states such as `ORDER_IN_PROGRESS`,
`PAYMENT_PENDING`, and `NOT_FOUND`. This gives Toss a short window to make a just-created sandbox
order visible before the application decides whether to grant or defer the purchase.

## API

- `POST /internal/mtls/request`: generic mTLS JSON relay.
- `POST /internal/apps-in-toss/toss-login/complete`: Toss Login adapter.
- `POST /internal/apps-in-toss/toss-login/remove-by-user-key`: Toss Login unlink adapter.
- `POST /internal/apps-in-toss/iap/order/status`: in-app purchase order status adapter.
- `POST /internal/apps-in-toss/promotion/reward/grant`: promotion reward adapter.
- `POST /internal/apps-in-toss/smart-message/send`: smart message adapter.
- `POST /internal/apps-in-toss/smart-message/send-bulk`: functional smart-message bulk adapter.
- `GET /internal/apps-in-toss/health`: local health/mode check.

## Backend Integration Contract

Application backends should treat the proxy as an internal HTTP dependency:

```text
MTLS_PROXY_URL=http://toss-mtls-client-proxy:8787
MTLS_PROXY_TOKEN=replace-with-internal-proxy-token
```

Generate `MTLS_PROXY_TOKEN` with a high-entropy random value such as `openssl rand -hex 32`.

When `MTLS_PROXY_TOKEN` is set, every proxy request, including health checks, must include:

```http
Authorization: Bearer <MTLS_PROXY_TOKEN>
```

POST requests with JSON bodies should also include:

```http
Content-Type: application/json
```

Minimal curl smoke:

```bash
curl -sS "$MTLS_PROXY_URL/internal/apps-in-toss/health" \
  -H "Authorization: Bearer $MTLS_PROXY_TOKEN"
```

Template smoke script:

```bash
templates/trailbase/scripts/toss-proxy-smoke.sh --health-only
templates/trailbase/scripts/toss-proxy-smoke.sh --full --expect-mode stub
```

Use `--health-only` for production pre-QA because it checks internal reachability and requires the
health response to report `mode: "forward"` by default. Use `--full --expect-mode stub` only in
local stub environments where fake adapter payloads are safe. Running the script without arguments
uses health-only mode.

Minimal Node/Fetch helper:

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

Adapter request bodies:

- Toss Login:

  ```json
  {
    "authorizationCode": "code-from-appLogin",
    "referrer": "SANDBOX"
  }
  ```

  Forward mode returns the resolved Toss `userKey` plus token metadata such as `accessToken`,
  `refreshToken`, `tokenType`, and `expiresIn`. Treat those token fields as backend-only secrets:
  do not send them to the RN client, logs, analytics, public tables, or audit metadata. If an app
  supports service-side unlink later, store the token material in the app's private identity storage
  using its own encryption/retention policy.

- Toss Login unlink by `userKey`:

  ```json
  {
    "tossUserKey": "toss-user-key",
    "accessToken": "toss-login-access-token"
  }
  ```

  The adapter forwards the official remove-by-user-key request to Toss, then normalizes the response
  to `ok`, `providerStatus`, and `resultType` without echoing the raw Toss `userKey`. The internal
  request still uses `Authorization: Bearer <MTLS_PROXY_TOKEN>` for the proxy itself; pass the Toss
  Login AccessToken in the JSON body so the proxy can send it upstream as Toss's
  `Authorization: Bearer <AccessToken>` header.

- IAP order status:

  ```json
  {
    "orderId": "order-123",
    "tossUserKey": "toss-user-key"
  }
  ```

  Store the proxy result in an app-owned order ledger before applying local
  product grants. TrailBase apps can start from
  `templates/trailbase/sql/iap_orders.sql` and
  `trailbase_guest_common::iap_orders`; see [iap-orders.md](iap-orders.md).

- Promotion reward grant:

  ```json
  {
    "providerRequestId": "reward-20260610-001",
    "tossUserKey": "toss-user-key",
    "promotionCode": "PROMOTION_CODE",
    "amount": 50
  }
  ```

- Smart Message send:

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

- Smart Message bulk send:

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

- Generic relay:

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

Use `providerRequestId` values from the application ledger or outbox when the app needs idempotency,
operator audit, or retry correlation. The proxy returns JSON on the same request and does not persist
application state.

The smart-message adapter sends `tossUserKey` as `x-toss-user-key` and removes it from the upstream
JSON body. It normalizes the Toss messenger response into app-friendly fields:
`providerStatus`, `resultType`, `msgCount`, `sentPushCount`, `sentInboxCount`, `detail`, `fail`,
`failureReason`, and `failures[].reachFailReason`. A partial delivery with at least one successful
channel is treated as `SENT` so dispatch jobs do not retry and duplicate the delivered channel.
The proxy does not request or verify notification agreement. Consumer apps must
call the Apps in Toss `requestNotificationAgreement` SDK where required, persist
the agreement result, and gate dispatch before calling this adapter.

The bulk adapter calls AppsInToss
`/api-partner/v1/apps-in-toss/messenger/send-bulk-message`. Group only functional
messages that share the same `templateSetCode`, and keep each request at or
below the Toss limit of 2,500 recipients. Consumer outbox jobs should split
larger audiences into subsequent batches.

The promotion reward adapter accepts `promotionCode` and `amount` in the request body.
`promotionAmount` is also accepted as a compatibility alias, but new callers should prefer `amount`.
When campaign fields are omitted, the proxy falls back to `TOSS_PROMOTION_CODE` and
`TOSS_PROMOTION_AMOUNT` for existing env-only consumers. Apps with their own campaign database should
pass campaign values per request and use the proxy only as the private mTLS boundary. Upstream
promotion error codes are normalized into `providerErrorCode` when Toss returns codes such as `4109`,
`4112`, `4114`, or `4116`.

For DB-backed campaigns, copy `templates/trailbase/sql/promotion_campaigns.sql` into the consumer
app's migration set. New apps can also start from
`templates/trailbase/sql/promotion_reward_ledger.sql`; existing apps should migrate their ledgers
forward. Store proxy `providerErrorCode` values on those ledgers so operators can pause or exhaust
campaigns without hard-coding promotion configuration in env files. See
[promotion-campaigns.md](promotion-campaigns.md) for the app-side campaign and ledger pattern.

The Toss Login adapter expects the `authorizationCode` and `referrer` returned by `appLogin()`.
Forward the SDK `referrer` value as-is. In sandbox RN builds this can be `SANDBOX`, and changing the
casing can make Toss reject the one-time authorization code as `invalid_grant`.
TrailBase WASM consumers should use `trailbase_guest_common::apps_in_toss_login::normalize_login_referrer`
when preparing the proxy/forward request instead of hand-rolled uppercase/lowercase normalization.
In proxy mode, the complete adapter also returns Toss token metadata so the backend has a supported
path for later service-side unlink. Keep that metadata inside the backend identity boundary and seal
it before persistence when reversible access is needed.

Consumer app servers should not treat `referrer=SANDBOX` as a local stub signal. An
`authorizationCode` from the real AppsInToss sandbox app still needs to be exchanged server-side for
the real sandbox `userKey`. Keep local development stubs explicit with `TOSS_LOGIN_MODE=stub`, or
limit them to `dev-*` authorization codes produced by a simulator fallback when the SDK is absent.
When `TOSS_LOGIN_MODE=proxy` or `forward`, send `SANDBOX` referrers through the proxy/forward path so
promotion, smart-message, and functional-notification QA stores a usable userKey.

The generic relay accepts a JSON body shaped like:

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

`path` must be a relative absolute path, not a full URL. In forward mode, the proxy joins it with
`MTLS_UPSTREAM_BASE_URL`, opens the outbound mTLS request with the mounted certificate files, and
returns `{ "ok": boolean, "status": number, "headers": object, "body": unknown }`.

Use the AppsInToss adapter endpoints when their request and response shape fits the app. Use the
generic relay for other Toss mTLS APIs, or add a small adapter when an API needs repeated
normalization or multi-step flow handling.
