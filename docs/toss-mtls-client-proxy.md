# Toss mTLS Client Proxy

`toss-mtls-client-proxy` is an internal client proxy. It is not a public callback server. TrailBase
calls it over the Compose internal network, and the proxy opens outbound mTLS connections to Toss.
Responses return on the same outbound request, so the proxy does not need public ingress.

## Runtime Model

- Image may be public.
- Instance should be internal-only.
- Certificate files are mounted into the proxy container only.
- TrailBase receives only `MTLS_PROXY_URL` and `MTLS_PROXY_TOKEN`.

## Minimal Environment

```text
MTLS_PROXY_MODE=stub|forward
MTLS_PROXY_TOKEN=...
MTLS_UPSTREAM_BASE_URL=https://apps-in-toss-api.toss.im
```

Certificates default to:

```text
/run/mtls/client-cert.pem
/run/mtls/client-key.pem
/run/mtls/ca-cert.pem
```

## API

- `POST /internal/mtls/request`: generic mTLS JSON relay.
- `POST /internal/apps-in-toss/toss-login/complete`: Toss Login adapter.
- `POST /internal/apps-in-toss/iap/order/status`: in-app purchase order status adapter.
- `POST /internal/apps-in-toss/promotion/reward/grant`: promotion reward adapter.
- `POST /internal/apps-in-toss/smart-message/send`: smart message adapter.
- `GET /internal/apps-in-toss/health`: local health/mode check.
