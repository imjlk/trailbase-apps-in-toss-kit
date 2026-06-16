#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${TOSS_PROXY_SMOKE_URL:-${MTLS_PROXY_URL:-http://127.0.0.1:8787}}"
MODE="health"
EXPECTED_MODE=""

usage() {
  cat <<'EOF'
Usage: toss-proxy-smoke.sh [--health-only|--full] [--expect-mode stub|forward]

  --health-only  Check only /internal/apps-in-toss/health. This is the default.
  --full         Run health plus stub/sandbox adapter calls.
  --expect-mode  Require the health response mode. Defaults to forward for health-only and stub for full.
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --health-only)
      MODE="health"
      ;;
    --full)
      MODE="full"
      ;;
    --expect-mode)
      shift
      if [ "$#" -eq 0 ]; then
        usage >&2
        exit 2
      fi
      EXPECTED_MODE="$1"
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      usage >&2
      exit 2
      ;;
  esac
  shift
done

if [ -z "$EXPECTED_MODE" ]; then
  if [ "$MODE" = "full" ]; then
    EXPECTED_MODE="stub"
  else
    EXPECTED_MODE="forward"
  fi
fi

case "$EXPECTED_MODE" in
  stub|forward)
    ;;
  *)
    echo "Expected proxy mode must be stub or forward." >&2
    exit 2
    ;;
esac

if [ "$MODE" = "full" ] && [ "$EXPECTED_MODE" != "stub" ]; then
  echo "--full smoke sends fake adapter payloads and requires --expect-mode stub." >&2
  exit 2
fi

curl_proxy() {
  if [ -n "${MTLS_PROXY_TOKEN:-}" ]; then
    curl -fsS -H "authorization: Bearer ${MTLS_PROXY_TOKEN}" "$@"
  else
    curl -fsS "$@"
  fi
}

HEALTH_RESPONSE="$(curl_proxy "${BASE_URL%/}/internal/apps-in-toss/health")"
printf '%s\n' "$HEALTH_RESPONSE"

HEALTH_MODE="$(printf '%s' "$HEALTH_RESPONSE" | sed -nE 's/.*"mode"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/p')"
if [ "$HEALTH_MODE" != "$EXPECTED_MODE" ]; then
  echo "Expected proxy mode ${EXPECTED_MODE}, got ${HEALTH_MODE:-unknown}." >&2
  exit 1
fi

if [ "$MODE" = "health" ]; then
  exit 0
fi

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
