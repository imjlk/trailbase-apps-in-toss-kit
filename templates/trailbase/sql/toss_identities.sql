CREATE TABLE IF NOT EXISTS toss_identities (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  toss_user_key_hmac TEXT NOT NULL UNIQUE,
  toss_user_key_sealed TEXT,
  referrer TEXT NOT NULL,
  scope_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(scope_json)),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'REVOKED')),
  linked_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  revoked_at INTEGER,
  revoke_referrer TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (
    status = 'REVOKED'
    OR length(trim(COALESCE(toss_user_key_sealed, ''))) > 0
  )
) STRICT;

CREATE INDEX IF NOT EXISTS idx_toss_identities_user_status
  ON toss_identities(user_id, status);

CREATE INDEX IF NOT EXISTS idx_toss_identities_active_last_seen
  ON toss_identities(last_seen_at DESC)
  WHERE status = 'ACTIVE';
