CREATE TABLE IF NOT EXISTS profiles (
  user_id BLOB PRIMARY KEY REFERENCES _user(id) ON DELETE CASCADE,
  anonymous_hash_hmac TEXT NOT NULL UNIQUE,
  auth_state TEXT NOT NULL DEFAULT 'anonymous' CHECK (
    auth_state IN ('anonymous', 'toss_linked', 'email_linked', 'disabled')
  ),
  toss_linked_at INTEGER,
  email_verified_at INTEGER,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_profiles_auth_state_updated
  ON profiles(auth_state, updated_at DESC);
