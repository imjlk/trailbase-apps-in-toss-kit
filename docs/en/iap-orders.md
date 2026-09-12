# IAP Orders

AppsInToss in-app purchase handling has two separate responsibilities:

- The mTLS proxy checks the Toss order status with `orderId` and the sealed
  `tossUserKey`.
- The app backend owns the local order ledger, product grant, inventory/balance
  update, restore flow, and idempotency.

Copy `templates/trailbase/sql/iap_orders.sql` into the consumer app migration
set when TrailBase should persist order/grant state. Existing apps with their
own `iap_orders` table should add compatible columns with forward migrations
instead of replacing the table.

## Runtime Flow

1. RN receives or restores an AppsInToss IAP `orderId`.
2. The app backend loads the active Toss identity for the authenticated `_user`.
3. The backend calls `/internal/apps-in-toss/iap/order/status` on the private
   proxy.
4. `trailbase_guest_common::iap_orders` normalizes the provider response and can
   upsert the local `iap_orders` row.
5. If the normalized status is `PENDING_GRANT`, the app applies its product
   grant exactly once and then calls `mark_iap_order_granted_tx`.

The shared helper deliberately does not know product entitlement rules, local
currency names, inventory tables, restore UX, or refund policy. Keep those in
the consumer app.

## Safety Notes

- Store `_user` ids and optional `toss_user_key_hmac`; never store raw Toss
  `userKey` in `iap_orders`.
- Preserve an already `GRANTED` order when a later non-refund status check
  returns a transient provider state.
- Use `grant_payload_json` only for app-internal grant metadata. Do not expose
  raw provider responses or internal grant payloads through public Record API
  views.
- Keep high-volume analytics separate. IAP order/grant rows are functional
  ledgers, not analytics sink events.

## Grant and Completion Recovery

`mark_iap_order_granted_tx` now records `granted_at` without filling
`completed_at`. Commit the local inventory change and grant marker together.
After Toss `completeProductGrant` succeeds, call `mark_iap_order_completed_tx`
from the authenticated backend, or persist a verified provider completion status.
The completion helper only accepts an already locally granted, non-refunded order
and preserves the first confirmation timestamp on retries.

`GRANTED` with a null `completed_at` needs only Toss completion recovery; do not
grant inventory again. Authorize order ownership before either helper. Existing
rows whose timestamps were set together remain historical data; do not clear
them automatically. No schema change is needed for the existing kit template.

See [IAP Subscriptions](iap-subscriptions.md) for RN adapters and the private webhook/entitlement ledger.

New order rows require a successful, owner-scoped provider lookup with returned
order ID/SKU and PAYMENT_COMPLETED, PURCHASED, or REFUNDED state. Failed, missing,
unknown, in-progress, or fallback-only responses cannot reserve a new order ID;
`upsert_iap_order_status_tx` returns `UNVERIFIED_IAP_ORDER` if no matching row can
be updated. Existing-owner diagnostic updates remain supported. Never feed client
SDK data or a lookup without the authenticated owner identity into this helper.
