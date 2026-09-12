# IAP Subscriptions

The RN reference SDK `2.10.10` includes subscription purchase and status methods.
`createAppsInTossIapBridge` exposes `purchaseSubscription({ sku, offerId,
processProductGrant })` and `getSubscriptionInfo({ orderId })`. Product lists
preserve CONSUMABLE, NON_CONSUMABLE, SUBSCRIPTION, renewalCycle, and offers. Older
injected SDKs remain usable for existing methods; each new API reports unavailable
or unsupported separately. An undefined status response is unsupported, not an
expired subscription.

Subscription purchases use the existing bounded grant/cleanup flow and pass the
optional subscriptionId to the backend grant callback and purchase result. Restore
still uses pending orders and completeProductGrant. Keep backend order verification
and idempotent local granting in place; client SDK status is presentation data and
must not independently authorize server benefits.

See the [official subscription guide](https://developers-apps-in-toss.toss.im/documentation/common/monetization/iap/in-app-subscription).
Toss currently does not support subscription testing in the sandbox app. Local
adapter/type/SQL tests are separate from the required real Toss app checks.

## Consumer Webhook Ingress

Apply `iap_subscriptions.sql` after `iap_orders.sql` as a new consumer migration.
It creates a private typed-event inbox and current entitlement projection per
verified order. Existing purchase rows and grants are preserved.

Receive callbacks on the consumer's public backend, with the consumer's trusted
ingress/authentication controls. The reference guide does not establish a signature
verification algorithm, so this kit does not invent one or expose an unauthenticated
route. Never call the entitlement helper on an arbitrary public request or on a
client-provided getSubscriptionInfo result. The mTLS proxy remains outbound-only.

1. After ingress verification, parse with `iap_subscriptions::parse_subscription_webhook`.
   Accept callback.registration_verification as a registration check only; it
   grants no entitlement. Unknown event types/versions and malformed states fail.
2. For subscription.status_changed, call `apply_subscription_event_tx` and commit.
   Typed serialization omits unrelated raw fields. Duplicate events are ignored;
   older events cannot overwrite newer state. Different events with equal timestamps
   mark needs_reconciliation and cannot overwrite the current snapshot.
3. UnmappedOrder retains the inbox event as RECEIVED. Map the order to its owner and
   SKU using the existing trusted purchase verification flow, then deserialize the
   stored payload as SubscriptionStatusEvent and replay it. The helper never creates
   a user or guesses the owner of a renewal order.
4. Read with `subscription_entitlement_for_user_tx`, which checks ownership through
   iap_orders. Use `subscription_access_allowed` with the app's disabled-user and
   benefit rules. It rejects reconciliation conflicts, revoked/paused/held/expired
   states, denied access, and an expired ACTIVE term.

The inbox and entitlement tables must not be exposed through a public Record API.
Entitlements are per order: the consumer owns the authoritative mapping of renewal
orders to a subscription/account and the aggregation of benefits across orders.
This avoids letting a callback for an old order overwrite an unrelated new order.
Keep currency/inventory grants separate from this current access projection.

## Time and Recovery Policy

The official webhook timestamps contain no timezone. The helper validates and
canonicalizes provider-local ISO-8601 timestamps, including fractional seconds,
for ordering. It rejects offsets instead of guessing UTC. Configure the provider
clock conversion explicitly and pass that local clock to subscription_access_allowed.

IN_GRACE_PERIOD uses the trusted accessGranted flag: the webhook has no separate
grace-expiry field, and the paid term's expiresAt may already be past. Apply the
consumer's webhook freshness/reconciliation policy before allowing benefits when
updates may be missing. A newer valid event clears an earlier equal-time conflict;
otherwise resolve the conflict from an authoritative provider state. Do not resolve
it by assigning arbitrary precedence to ACTIVE versus REVOKED.

Order existence alone never proves ownership. Applying and reading entitlements
requires a paid/refunded ledger state backed by PAYMENT_COMPLETED, PURCHASED, or
REFUNDED provider state. Unverified legacy rows keep callbacks RECEIVED and expose
no entitlement, including projections written before this guard. Resolve conflicting
legacy ownership only through a trusted owner-scoped lookup and an audited consumer
repair; a webhook never reassigns the order. Registration callbacks may omit
eventVersion; an explicitly supplied version must be the supported string `1.0`.
