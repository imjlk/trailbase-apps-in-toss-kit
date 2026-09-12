-- Private webhook inbox and current entitlement per verified order.
CREATE TABLE IF NOT EXISTS iap_subscription_events (
  event_id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  disposition TEXT NOT NULL DEFAULT 'RECEIVED' CHECK (disposition IN ('RECEIVED','APPLIED','STALE','CONFLICT')),
  received_at INTEGER NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS idx_iap_subscription_events_pending
  ON iap_subscription_events(order_id,occurred_at) WHERE disposition='RECEIVED';

CREATE TABLE IF NOT EXISTS iap_subscription_entitlements (
  order_id TEXT PRIMARY KEY REFERENCES iap_orders(order_id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('ACTIVE','EXPIRED','IN_GRACE_PERIOD','ON_HOLD','PAUSED','REVOKED')),
  access_granted INTEGER NOT NULL CHECK (access_granted IN (0,1)),
  expires_at TEXT,
  auto_renew INTEGER NOT NULL CHECK (auto_renew IN (0,1)),
  occurred_at TEXT NOT NULL,
  event_id TEXT NOT NULL REFERENCES iap_subscription_events(event_id),
  needs_reconciliation INTEGER NOT NULL DEFAULT 0 CHECK (needs_reconciliation IN (0,1)),
  updated_at INTEGER NOT NULL
) STRICT;
