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

## Minimal Environment

```text
MTLS_PROXY_MODE=stub|forward
MTLS_PROXY_TOKEN=...
MTLS_UPSTREAM_BASE_URL=https://apps-in-toss-api.toss.im
```

`MTLS_PROXY_TOKEN` is required in `forward` mode. Stub mode can run without a token for local smoke
tests, but production deployments should always set one.

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
`MTLS_CLIENT_CERT_PATH` and `MTLS_CLIENT_KEY_PATH`. `MTLS_CA_CERT_PATH` is optional and is loaded only
when the file exists.

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
- `POST /internal/apps-in-toss/iap/order/status`: in-app purchase order status adapter.
- `POST /internal/apps-in-toss/promotion/reward/grant`: promotion reward adapter.
- `POST /internal/apps-in-toss/smart-message/send`: smart message adapter.
- `GET /internal/apps-in-toss/health`: local health/mode check.

The smart-message adapter sends `tossUserKey` as `x-toss-user-key` and removes it from the upstream
JSON body. It normalizes the Toss messenger response into app-friendly fields:
`providerStatus`, `resultType`, `msgCount`, `sentPushCount`, `sentInboxCount`, `detail`, `fail`,
`failureReason`, and `failures[].reachFailReason`. A partial delivery with at least one successful
channel is treated as `SENT` so dispatch jobs do not retry and duplicate the delivered channel.

The promotion reward adapter accepts `promotionCode` and `amount` in the request body.
`promotionAmount` is also accepted as a compatibility alias, but new callers should prefer `amount`.
When campaign fields are omitted, the proxy falls back to `TOSS_PROMOTION_CODE` and
`TOSS_PROMOTION_AMOUNT` for existing env-only consumers. Apps with their own campaign database should
pass campaign values per request and use the proxy only as the private mTLS boundary. Upstream
promotion error codes are normalized into `providerErrorCode` when Toss returns codes such as `4109`,
`4112`, `4114`, or `4116`.

For DB-backed campaigns, copy `templates/trailbase/sql/promotion_campaigns.sql` into the consumer
app's migration set, keep eligibility and reward ledgers app-specific, and store proxy
`providerErrorCode` values on those ledgers so operators can pause or exhaust campaigns without
hard-coding promotion configuration in env files. See
[promotion-campaigns.md](promotion-campaigns.md) for the app-side campaign and ledger pattern.

The Toss Login adapter expects the `authorizationCode` and `referrer` returned by `appLogin()`.
Forward the SDK `referrer` value as-is. In sandbox RN builds this can be `SANDBOX`, and changing the
casing can make Toss reject the one-time authorization code as `invalid_grant`.

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
