CREATE TABLE IF NOT EXISTS anonymous_user_links (
  anonymous_hash_hmac TEXT PRIMARY KEY,
  canonical_user BLOB NOT NULL REFERENCES _user(id) ON DELETE CASCADE,
  canonical_anonymous_hash_hmac TEXT NOT NULL,
  previous_user BLOB REFERENCES _user(id) ON DELETE SET NULL,
  link_reason TEXT NOT NULL CHECK (
    link_reason IN ('toss_identity_collision', 'manual_merge', 'migration')
  ),
  linked_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_anonymous_user_links_canonical_user
  ON anonymous_user_links(canonical_user);
