CREATE TABLE IF NOT EXISTS promotion_reward_ledger (
  id TEXT PRIMARY KEY,
  user_id BLOB NOT NULL REFERENCES _user(id) ON DELETE CASCADE,
  campaign_id TEXT REFERENCES promotion_campaigns(id) ON DELETE SET NULL,
  source_type TEXT NOT NULL CHECK (length(trim(source_type)) > 0),
  source_id TEXT,
  reward_amount INTEGER NOT NULL CHECK (reward_amount > 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (
    status IN ('recorded', 'pending', 'success', 'failed', 'cancelled')
  ),
  provider TEXT NOT NULL DEFAULT 'TOSS' CHECK (length(trim(provider)) > 0),
  provider_request_id TEXT NOT NULL UNIQUE CHECK (length(trim(provider_request_id)) > 0),
  provider_status TEXT,
  provider_error_code TEXT,
  provider_transaction_key TEXT,
  provider_response_json TEXT CHECK (
    provider_response_json IS NULL
    OR json_valid(provider_response_json)
  ),
  requested_at INTEGER NOT NULL,
  granted_at INTEGER,
  failed_at INTEGER,
  failure_reason TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_promotion_reward_ledger_user_created
  ON promotion_reward_ledger(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_promotion_reward_ledger_campaign_status
  ON promotion_reward_ledger(campaign_id, status, created_at DESC)
  WHERE campaign_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_promotion_reward_ledger_source
  ON promotion_reward_ledger(source_type, source_id, created_at DESC)
  WHERE source_id IS NOT NULL;
