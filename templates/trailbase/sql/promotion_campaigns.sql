CREATE TABLE IF NOT EXISTS promotion_campaigns (
  id TEXT PRIMARY KEY,
  feature_key TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'TOSS' CHECK (provider IN ('TOSS')),
  provider_promotion_code TEXT NOT NULL CHECK (length(trim(provider_promotion_code)) > 0),
  reward_amount INTEGER NOT NULL CHECK (reward_amount > 0),
  status TEXT NOT NULL CHECK (status IN ('DRAFT', 'ACTIVE', 'PAUSED', 'ENDED', 'EXHAUSTED')),
  starts_at INTEGER,
  ends_at INTEGER,
  budget_limit_amount INTEGER CHECK (budget_limit_amount IS NULL OR budget_limit_amount > 0),
  max_grant_count INTEGER CHECK (max_grant_count IS NULL OR max_grant_count > 0),
  notes TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (starts_at IS NULL OR ends_at IS NULL OR starts_at < ends_at),
  CHECK (
    status <> 'ACTIVE'
    OR (
      starts_at IS NOT NULL
      AND ends_at IS NOT NULL
      AND budget_limit_amount IS NOT NULL
    )
  )
) STRICT;

CREATE INDEX IF NOT EXISTS idx_promotion_campaigns_active_feature
  ON promotion_campaigns(feature_key, status, starts_at DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_promotion_campaigns_active_feature_window
  ON promotion_campaigns(feature_key, starts_at DESC, created_at DESC)
  WHERE status = 'ACTIVE';

CREATE INDEX IF NOT EXISTS idx_promotion_campaigns_provider_code
  ON promotion_campaigns(provider, provider_promotion_code);
