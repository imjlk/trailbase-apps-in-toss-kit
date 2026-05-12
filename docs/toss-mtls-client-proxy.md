# Toss mTLS Client Proxy

`toss-mtls-client-proxy` is an internal client proxy. It is not a public callback server. TrailBase
can call it over the Compose internal network, and the proxy opens outbound mTLS connections to Toss.
Responses return on the same outbound request, so the proxy does not need public ingress.

The container is reusable outside TrailBase. A Node, Rails, Spring, Go, FastAPI, or other backend can
run it on the same private network, send authenticated HTTP requests to the proxy, and keep mTLS
certificates out of the application container.

## Runtime Model

- Image may be public.
- Instance should be internal-only.
- Certificate files are mounted into the proxy container only.
- Application services receive only the internal proxy URL and `MTLS_PROXY_TOKEN`.
- Production deployments should pin the image to an exact SemVer or minor tag, not `latest` or
  `edge`, unless moving tags are intentional.

## Minimal Environment

```text
MTLS_PROXY_MODE=stub|forward
MTLS_PROXY_TOKEN=...
MTLS_UPSTREAM_BASE_URL=https://apps-in-toss-api.toss.im
```

`MTLS_PROXY_TOKEN` is required in `forward` mode. Stub mode can run without a token for local smoke
tests, but production deployments should always set one.

Certificates default to:

```text
/run/mtls/client-cert.pem
/run/mtls/client-key.pem
/run/mtls/ca-cert.pem
```

Optional safety limits:

```text
MTLS_PROXY_REQUEST_BODY_LIMIT_BYTES=1048576
MTLS_PROXY_UPSTREAM_BODY_LIMIT_BYTES=2097152
MTLS_PROXY_UPSTREAM_TIMEOUT_MS=15000
```

## API

- `POST /internal/mtls/request`: generic mTLS JSON relay.
- `POST /internal/apps-in-toss/toss-login/complete`: Toss Login adapter.
- `POST /internal/apps-in-toss/iap/order/status`: in-app purchase order status adapter.
- `POST /internal/apps-in-toss/promotion/reward/grant`: promotion reward adapter.
- `POST /internal/apps-in-toss/smart-message/send`: smart message adapter.
- `GET /internal/apps-in-toss/health`: local health/mode check.

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
