-- Private app-owned currency journal. Do not expose this table through the
-- Record API. A row is an accounting fact, not a balance projection.
--
-- Copy this template into a consumer migration and keep the migration
-- forward-only. The optional user reference is set to NULL when the TrailBase
-- user is deleted so a closed-period report does not regain a user identity.
CREATE TABLE IF NOT EXISTS owned_currency_events (
  id TEXT PRIMARY KEY CHECK (length(trim(id)) BETWEEN 1 AND 128),
  user_id BLOB REFERENCES _user(id) ON DELETE SET NULL,
  currency_code TEXT NOT NULL CHECK (
    length(trim(currency_code)) BETWEEN 1 AND 64
    AND currency_code NOT GLOB '*[^A-Za-z0-9._-]*'
  ),
  unit_code TEXT NOT NULL CHECK (
    length(trim(unit_code)) BETWEEN 1 AND 64
    AND unit_code NOT GLOB '*[^A-Za-z0-9._-]*'
  ),
  event_type TEXT NOT NULL CHECK (
    event_type IN (
      'ISSUE',
      'SPEND',
      'CONVERT_IN',
      'CONVERT_OUT',
      'EXCHANGE',
      'EXPIRE',
      'ADJUSTMENT'
    )
  ),
  -- Quantities are signed integer minor units. Never use floating point for
  -- grams, points, or valuation values.
  quantity INTEGER NOT NULL CHECK (quantity <> 0),
  source_type TEXT NOT NULL CHECK (length(trim(source_type)) BETWEEN 1 AND 64),
  source_id TEXT NOT NULL CHECK (length(trim(source_id)) BETWEEN 1 AND 256),
  idempotency_key TEXT NOT NULL UNIQUE CHECK (
    length(trim(idempotency_key)) BETWEEN 1 AND 256
  ),
  policy_version TEXT NOT NULL CHECK (length(trim(policy_version)) BETWEEN 1 AND 64),
  conversion_group_id TEXT CHECK (
    conversion_group_id IS NULL
    OR (
      length(trim(conversion_group_id, ' ' || char(9) || char(10) || char(13))) BETWEEN 1 AND 256
      AND conversion_group_id = trim(conversion_group_id, ' ' || char(9) || char(10) || char(13))
    )
  ),
  exchange_id TEXT CHECK (
    exchange_id IS NULL
    OR (
      length(trim(exchange_id, ' ' || char(9) || char(10) || char(13))) BETWEEN 1 AND 256
      AND exchange_id = trim(exchange_id, ' ' || char(9) || char(10) || char(13))
    )
  ),
  valuation_amount INTEGER CHECK (valuation_amount IS NULL OR valuation_amount >= 0),
  valuation_currency_code TEXT CHECK (
    valuation_currency_code IS NULL
    OR (
      length(trim(valuation_currency_code)) BETWEEN 1 AND 64
      AND valuation_currency_code NOT GLOB '*[^A-Za-z0-9._-]*'
    )
  ),
  occurred_at INTEGER NOT NULL CHECK (occurred_at >= 0),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
  CHECK (
    (event_type IN ('ISSUE', 'CONVERT_IN') AND quantity > 0)
    OR (event_type IN ('SPEND', 'CONVERT_OUT', 'EXCHANGE', 'EXPIRE') AND quantity < 0)
    OR (event_type = 'ADJUSTMENT')
  ),
  CHECK ((valuation_amount IS NULL) = (valuation_currency_code IS NULL)),
  CHECK (
    event_type NOT IN ('CONVERT_IN', 'CONVERT_OUT')
    OR conversion_group_id IS NOT NULL
  ),
  CHECK (
    event_type <> 'EXCHANGE'
    OR exchange_id IS NOT NULL
  )
) STRICT;

CREATE INDEX IF NOT EXISTS idx_owned_currency_events_currency_time
  ON owned_currency_events(currency_code, unit_code, occurred_at);

CREATE INDEX IF NOT EXISTS idx_owned_currency_events_time
  ON owned_currency_events(occurred_at, currency_code, unit_code);

CREATE INDEX IF NOT EXISTS idx_owned_currency_events_user_time
  ON owned_currency_events(user_id, occurred_at DESC)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_owned_currency_events_source
  ON owned_currency_events(source_type, source_id);

CREATE INDEX IF NOT EXISTS idx_owned_currency_events_conversion
  ON owned_currency_events(conversion_group_id, occurred_at)
  WHERE conversion_group_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_owned_currency_events_exchange
  ON owned_currency_events(exchange_id, occurred_at)
  WHERE exchange_id IS NOT NULL;
