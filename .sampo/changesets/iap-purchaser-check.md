---
cargo/trailbase-guest-common: minor
cargo/trailbase-toss-identity: minor
npm/@trailbase-apps-in-toss-kit/toss-mtls-client-proxy: minor
---

IAP order-status lookups now check who bought the order. The Apps in Toss API reports `purchaserMatched` for the user named in the lookup, and the proxy (via `@ait-kit/api-core` 0.8) returns it as `purchaserCheck.status`: `MATCHED`, `MISMATCHED` or `NOT_PROVIDED`. The identifier is sent only in the official `x-toss-user-key` / `x-anon-key` header and is never echoed back.

- **Proxy:** A payable order whose purchaser check is `MISMATCHED` now fails with `UNVERIFIED_IAP_ORDER` ("Toss order was bought by a different user"), so a caller cannot redeem someone else's paid `orderId`. `NOT_PROVIDED` passes through unchanged. Health metadata advertises the new `iap.purchaser-check` capability. Requests without a purchaser behave as before.
- **Rust:** `IapOrderStatus` gains `purchaser_check` and `purchaser_confirmed()`, which is true only for `MATCHED`. `iap_order_status_for_purchaser` with `IapPurchaser::AnonKey` covers anonymous WebView users and rejects a blank identifier before the request. `iap_order_status` is unchanged. Code that builds `IapOrderStatus` with a struct literal must add the new field.
- **Rollout:** Update the proxy image before relying on `purchaser_check`; older proxies omit it. Consumers decide whether `NOT_PROVIDED` should hold a grant.
