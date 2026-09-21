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
- `POST /internal/apps-in-toss/promotion/reward/prepare`: recipient-bound promotion key issuance.
- `POST /internal/apps-in-toss/promotion/reward/execute`: promotion execution with a persisted key.
- `POST /internal/apps-in-toss/promotion/reward/status`: promotion result lookup with the persisted key.
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

## API Core 0.4 Contracts

The proxy pins `@ait-kit/api-core` and `@ait-kit/api-client` to `0.5.1` and
explicitly opts into the generic mTLS relay. `/internal/mtls/request` remains
behind the same internal bearer authentication; forward mode still requires a
token. Bun is pinned to `1.4.2` across local tooling, CI, and the container.
The Compose copy-in template pins the published proxy image (see the
[rollout and verification record](ait-kit-rollout.md) for the current
baseline, rollout order, and remaining real-device checks); update the
consumer-owned image pin and reconcile migrations/WASM guests before enabling
new flows.

The local Node mTLS client is replaced by `@ait-kit/api-client/node`'s
transport: one overall deadline covers DNS, connect, TLS, headers, and the
entire response body; a response that breaks mid-body, exceeds the size
budget, or outlives the deadline fails closed with the proxy's existing
`UPSTREAM_*` error envelope. A response that cannot be converted into a fetch
`Response` (for example an out-of-range upstream status like 600) also fails
closed with the typed transport error. The plain-HTTP path for local/test
upstreams mirrors those guarantees and treats 204/205/304 as null-body
responses. Certificate files are still loaded by this repository; the
transport receives PEM contents.

Single Smart Message requests accept one of `tossUserKey`, `userKey`, or
`anonKey`. api-core emits the official `x-toss-user-key`/`x-anon-key`
headers itself, so the proxy no longer rewrites recipient headers. See the
[official message API](https://developers-apps-in-toss.toss.im/api/push).

Message outcomes follow the three-way taxonomy: confirmed send (`SENT`),
confirmed failure (`FAILED`, including 4xx and explicit provider rejections),
and outcome unknown (`UNKNOWN` with the internal `error: "INVALID_RESPONSE"`
marker — 5xx, empty/HTML bodies, conflicting status aliases, evidence-free
successes). The proxy passes the internal `error` marker through next to
`failureReason`/`providerErrorCode`, and 5xx responses preserve the caller's
`requestedAt` as request-time context without claiming a delivery time. The
kit's Rust parser quarantines UNKNOWN outcomes in the outbox ledger; see
[Functional Messages](functional-messages.md).

Promotion rewards run the persisted three-step contract only. The batch
`promotion/reward/grant` route is removed and answers `410
PROMOTION_GRANT_REMOVED` without touching the upstream — there is no grant
logic and no redirect left behind. `promotion/reward/prepare` takes exactly
one recipient (`userKey`/`tossUserKey`/`anonKey`), binds the issued
transaction key to it, and means key issuance only — never a grant.
`promotion/reward/execute` requires the persisted key; `SUBMITTED` results
are acceptance, not grants, and `UNKNOWN` results preserve the key for the
status lookup. `promotion/reward/status` passes the provider-observed
verdict through verbatim (`GRANTED`, `PENDING`, `FAILED`, `NOT_FOUND`,
`UNKNOWN`, with `checkedAt` observation time and no fabricated `grantedAt`)
and never allocates or executes. The `providerRequestId` field is
correlation-only: it does not make an external grant idempotent. Grant
ownership, idempotency, and concurrent-execution checks remain TrailBase's
responsibility; see [Promotion Campaigns](promotion-campaigns.md) for the
ledger flow and the v2 migration.

Partial delivery still returns `failureReason` and `failures[].reachFailReason`.
The upstream `reachedFailReason` field and per-channel details remain available.
A successful channel can coexist with failed channels; consumers must not retry
an entire partially delivered message automatically. Functional notification
agreement remains the consumer's responsibility before dispatch.

In forward IAP lookups, api-core separates provider evidence
(`verified`, `skuCheck`) from request expectations, and reads evidence
strictly: an orderId/status/SKU that is not a real string (including a
single-element array) is an `INVALID_RESPONSE`, and query-failure envelopes
(`FAIL`, `ERROR`, `NETWORK_ERROR`, …) yield no evidence even when a
contradictory success payload rides along. The proxy keeps its legacy
wire shape on top: PAYMENT_COMPLETED/PURCHASED responses without a provider SKU
(or naming a different order ID) return `ok: false` and `UNVERIFIED_IAP_ORDER`;
retry verification before granting anything. Explicit stub mode keeps synthetic
request-based products for local tests.

## Health Metadata

Authenticated health responses preserve `ok` and `mode` and add
`kit: { contractVersion: 1, proxyVersion, capabilities }`. The version comes from
the running package, and capabilities list implemented adapter contracts such as
`anonymous-key.verify`, `iap.provider-sku-required`, `promotion.prepare.v2`,
`promotion.execute.v2`, `promotion.status.v2`,
`promotion.anonymous-recipient`, and `smart-message.channel-results`; the
promotion capabilities are versioned (`.v2`) with the persisted three-step
contract, and `promotion.grant` is no longer advertised. The complete
list is maintained in `src/capabilities.mjs`. No upstream call or certificate/secret
content is included. This describes implementation availability, not readiness of
a specific campaign or user operation. See [Release Doctor](release-doctor.md#proxy-capability-preflight)
for deployment preflight checks. Old consumers can continue reading `ok`/`mode`.

## Shared Response Contracts

The synthetic corpus under `fixtures/contracts/` is checked by Rust, the proxy,
RN transport and ledger diagnostics. It covers provider aliases, missing payment
SKU, explicit failures and partial message delivery. An explicit failed promotion
response cannot become a grant through a contradictory status. A message response
with neither an explicit result flag nor a status field remains UNKNOWN; reconcile its
original request before any resend. These checks complement real provider tests.

Promotion failure-text privacy and safe numeric recipient validation are owned by
api-core 0.5.1. The proxy forwards those normalized results without recursively
rewriting them: transaction keys, error codes and observation timestamps remain
intact. Fractional/unsafe numeric recipient IDs are rejected before dispatch;
use exact strings for large IDs. This dependency update requires no new ledger
migration beyond the existing promotion v2 schema.
