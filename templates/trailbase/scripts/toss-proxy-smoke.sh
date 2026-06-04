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
  -d '{
    "authorizationCode": "smoke-authorization-code",
    "referrer": "SANDBOX"
  }' \
  "${BASE_URL%/}/internal/apps-in-toss/toss-login/complete"
printf '\n'

curl_proxy \
  -H 'content-type: application/json' \
  -d '{
    "providerRequestId": "smoke:reward:001",
    "eligibilityId": "smoke-eligibility",
    "userId": "smoke-user",
    "sourceType": "SMOKE",
    "sourceId": "smoke-source",
    "requestedAt": 1,
    "tossUserKey": "smoke-toss-user-key"
  }' \
  "${BASE_URL%/}/internal/apps-in-toss/promotion/reward/grant"
printf '\n'

curl_proxy \
  -H 'content-type: application/json' \
  -d '{
    "providerRequestId": "smoke:message:001",
    "messageId": "smoke-message",
    "userId": "smoke-user",
    "purpose": "FUNCTIONAL",
    "templateSetCode": "smoke_template",
    "context": {"kind": "smoke"},
    "idempotencyKey": "smoke-message-001",
    "requestedAt": 1,
    "tossUserKey": "smoke-toss-user-key"
  }' \
  "${BASE_URL%/}/internal/apps-in-toss/smart-message/send"
printf '\n'
