CREATE TABLE IF NOT EXISTS iap_orders (
  order_id TEXT PRIMARY KEY CHECK (length(trim(order_id)) > 0),
  user_id BLOB NOT NULL REFERENCES _user(id) ON DELETE CASCADE,
  toss_user_key_hmac TEXT,
  product_id TEXT NOT NULL CHECK (length(trim(product_id)) > 0),
  status TEXT NOT NULL CHECK (
    status IN ('FAILED', 'GRANTED', 'NOT_FOUND', 'PENDING', 'PENDING_GRANT', 'REFUNDED', 'UNKNOWN')
  ),
  provider_status TEXT NOT NULL,
  provider_reason TEXT,
  failure_reason TEXT,
  provider_response_json TEXT CHECK (
    provider_response_json IS NULL
    OR json_valid(provider_response_json)
  ),
  status_determined_at TEXT,
  grant_id TEXT,
  grant_payload_json TEXT CHECK (
    grant_payload_json IS NULL
    OR json_valid(grant_payload_json)
  ),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  granted_at INTEGER,
  completed_at INTEGER,
  refunded_at INTEGER,
  failed_at INTEGER
) STRICT;

CREATE INDEX IF NOT EXISTS idx_iap_orders_user_created
  ON iap_orders(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_iap_orders_product_status
  ON iap_orders(product_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_iap_orders_toss_user_key_hmac
  ON iap_orders(toss_user_key_hmac)
  WHERE toss_user_key_hmac IS NOT NULL;
