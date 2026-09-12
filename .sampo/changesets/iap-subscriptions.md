---
npm/@trailbase-apps-in-toss-kit/ait-rn: minor
cargo/trailbase-guest-common: minor
cargo/trailbase-toss-identity: minor
---

Add RN subscription purchase and status-query bridges with per-API support checks,
subscription identifiers, renewal cycles and offers, while retaining one-time
purchase/restore behavior and older injected SDK support for existing methods.

Add a private subscription webhook inbox and per-order entitlement projection.
Apply iap_subscriptions.sql after the order ledger as a new consumer migration.
Authenticate webhook ingress in the consumer, map renewal orders authoritatively,
and configure provider-local timestamp conversion explicitly. Duplicate/older
events cannot overwrite current state; equal-time conflicts require reconciliation.
Client SDK status never independently authorizes server benefits. Subscription
sandbox testing is unavailable, so validate the feature in the real Toss app
before consumer rollout. The proxy remains internal and outbound-only.

Prevent failed or fallback-only lookups from reserving new order IDs, and require
verified order state when applying or reading subscription entitlements. Handle
UNVERIFIED_IAP_ORDER for lookups that cannot establish a new owner mapping. Normalize
offer fields consistently and reject unsupported explicit registration versions.
