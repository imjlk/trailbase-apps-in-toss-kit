-- Private identity storage. Preserve the consumer's existing HMAC of ait:<hash>.
CREATE TABLE IF NOT EXISTS anonymous_identities (
  anonymous_hash_hmac TEXT PRIMARY KEY,
  user_id BLOB NOT NULL REFERENCES _user(id) ON DELETE CASCADE,
  anonymous_key_sealed TEXT NOT NULL,
  verified_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  revoked_at INTEGER
) STRICT;
CREATE INDEX IF NOT EXISTS idx_anonymous_identities_user
  ON anonymous_identities(user_id) WHERE revoked_at IS NULL;
