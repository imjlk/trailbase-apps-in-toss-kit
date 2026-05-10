#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${TOSS_PROXY_SMOKE_URL:-${MTLS_PROXY_URL:-http://127.0.0.1:8787}}"

curl_proxy() {
  if [ -n "${MTLS_PROXY_TOKEN:-}" ]; then
    curl -fsS -H "authorization: Bearer ${MTLS_PROXY_TOKEN}" "$@"
  else
    curl -fsS "$@"
  fi
}

curl_proxy "${BASE_URL%/}/internal/apps-in-toss/health"
printf '\n'

curl_proxy \
  -H 'content-type: application/json' \
  -d '{"authorizationCode":"smoke-authorization-code","referrer":"sandbox"}' \
  "${BASE_URL%/}/internal/apps-in-toss/toss-login/complete"
printf '\n'

curl_proxy \
  -H 'content-type: application/json' \
  -d '{"orderId":"smoke-order-001","sku":"loo.credits.50","tossUserKey":"smoke-toss-user-key"}' \
  "${BASE_URL%/}/internal/apps-in-toss/iap/order/status"
printf '\n'

curl_proxy \
  -H 'content-type: application/json' \
  -d '{"method":"POST","path":"/internal/smoke","body":{"kind":"smoke"}}' \
  "${BASE_URL%/}/internal/mtls/request" || true
printf '\n'
