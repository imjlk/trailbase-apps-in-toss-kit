CREATE TABLE IF NOT EXISTS toss_identities (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  toss_user_key_hmac TEXT NOT NULL UNIQUE,
  toss_user_key_sealed TEXT NOT NULL,
  scope_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(scope_json)),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'REVOKED')),
  linked_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_toss_identities_user_status
  ON toss_identities(user_id, status);

CREATE INDEX IF NOT EXISTS idx_toss_identities_linked_at
  ON toss_identities(linked_at);
