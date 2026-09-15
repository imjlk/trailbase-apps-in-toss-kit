---
npm/toss-mtls-client-proxy: minor
---

Adopt the shared @ait-kit 0.3 API contracts and Node mTLS transport.

- Pins `@ait-kit/api-core` and `@ait-kit/api-client` to `0.3.0` (exact pins preserved).
- Replaces the local Node mTLS client with `@ait-kit/api-client/node`: one overall deadline covers DNS, connect, TLS, headers, and the full response body; broken, oversized, or timed-out upstream responses fail closed with the existing `UPSTREAM_*` envelope. Certificate files are still loaded by this repo; only PEM contents cross into the transport.
- Removes the request-local header rewrites: api-core 0.3 emits the official `x-toss-user-key`/`x-anon-key` recipient headers itself for messages and promotions.
- Anonymous-key verification now calls `verifyAnonKey` instead of the generic relay; the public `{ok, valid, resultType, mode}` shape and redaction guarantees are unchanged.
- IAP responses keep the legacy wire shape on top of api-core 0.3's verified/skuCheck contract: payable responses without provider SKU (or naming a different order) still reject with `UNVERIFIED_IAP_ORDER`.
- Promotions adopt the three-step contract: the legacy grant endpoint preserves its shape (anonymous grants run prepare → execute → status internally), and new `promotion/reward/prepare`, `promotion/reward/execute`, `promotion/reward/status` endpoints let ledger callers persist the transaction key and recover lost execute responses via status. Ledger ownership, idempotency, and concurrency remain TrailBase's responsibility.
- Server startup, authentication, certificate loading, environment, container config, and health/capability metadata remain in this repository; new capabilities `promotion.prepare` and `promotion.execute` are advertised.
