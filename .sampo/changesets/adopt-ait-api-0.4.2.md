---
npm/@trailbase-apps-in-toss-kit/toss-mtls-client-proxy: minor
---

Adopt the published @ait-kit 0.4.2 API contracts and harden the compatibility boundaries.

- `@ait-kit/api-core` and `@ait-kit/api-client` move from exact `0.3.0` pins
  to `0.4.2`. The proxy's public endpoints, legacy wire shapes, and error
  envelopes are unchanged; api-orpc and api-cloudflare-service are still not
  dependencies of this kit.
- Message outcomes now follow the 0.4 taxonomy end to end: 5xx, empty/HTML
  bodies, conflicting non-failure status aliases, and evidence-free successes
  return `providerStatus: "UNKNOWN"` with the internal
  `error: "INVALID_RESPONSE"` marker passed through next to
  `failureReason`/`providerErrorCode`; 4xx and explicit provider rejections
  stay `FAILED`. 5xx responses keep the caller's `requestedAt` as request-time
  context without claiming a delivery time — the kit's Rust outbox parser
  quarantines UNKNOWN outcomes (see the messages changeset). Two tests that
  encoded the old "5xx = FAILED" assumption now pin the new split with an
  added 4xx case.
- The plain-HTTP forwarding path (local/test upstreams) now treats 205 like
  204/304 as a null-body response and converts the completed upstream
  response into a fetch `Response` before settling: a conversion failure
  (for example an out-of-range upstream status like 600) surfaces as the
  transport's typed `REQUEST_FAILED` error mapped to the existing 502
  envelope instead of an unhandled throw that strands the caller.
- IAP evidence handling rides api-core 0.4's strict reads: an
  orderId/status/SKU that is not a real string (including single-element
  arrays) is an `INVALID_RESPONSE`, and query-failure envelopes yield no
  evidence even when a contradictory success payload rides along. The
  payable-order policy is unchanged: no provider SKU evidence or an order-ID
  mismatch still rejects with `UNVERIFIED_IAP_ORDER`.
- New regressions cover 204/205/304 null bodies, out-of-range statuses,
  UNKNOWN message propagation for empty/HTML/conflicting responses, and the
  strict IAP evidence cases. Promotion prepare/execute/status endpoints,
  login, anonymous-key verification, and stub behavior are unchanged and
  retested.
