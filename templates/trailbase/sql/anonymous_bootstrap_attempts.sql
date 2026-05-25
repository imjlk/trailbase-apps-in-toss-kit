CREATE TABLE IF NOT EXISTS anonymous_bootstrap_attempts (
  bucket_key TEXT PRIMARY KEY,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  window_started_at INTEGER NOT NULL,
  last_attempt_at INTEGER NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_anonymous_bootstrap_attempts_last_attempt
  ON anonymous_bootstrap_attempts(last_attempt_at DESC);
