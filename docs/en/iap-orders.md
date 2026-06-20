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
