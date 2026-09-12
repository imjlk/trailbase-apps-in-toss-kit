-- Private app-owned credits. Do not expose either table through Record API.
-- A grant row is the credit itself. Keep spending/projections in the same database.
CREATE TABLE IF NOT EXISTS app_reward_attempts (
  id TEXT PRIMARY KEY CHECK (length(id) = 48),
  user_id BLOB NOT NULL REFERENCES _user(id) ON DELETE CASCADE,
  placement_id TEXT NOT NULL CHECK (length(placement_id) BETWEEN 1 AND 64),
  source TEXT NOT NULL CHECK (source IN ('AD', 'SHARE')),
  policy_version TEXT NOT NULL CHECK (length(policy_version) BETWEEN 1 AND 64),
  reward_unit TEXT NOT NULL CHECK (length(reward_unit) BETWEEN 1 AND 64),
  reward_amount INTEGER NOT NULL CHECK (reward_amount BETWEEN 1 AND 1000000000),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  expires_at INTEGER NOT NULL CHECK (expires_at > created_at AND expires_at - created_at <= 86400000)
) STRICT;

CREATE TABLE IF NOT EXISTS app_reward_grants (
  attempt_id TEXT PRIMARY KEY REFERENCES app_reward_attempts(id) ON DELETE CASCADE,
  granted_at INTEGER NOT NULL CHECK (granted_at >= 0)
) STRICT;

CREATE INDEX IF NOT EXISTS idx_app_reward_attempts_owner_placement
  ON app_reward_attempts(user_id, placement_id, created_at DESC);
