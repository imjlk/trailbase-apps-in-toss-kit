-- Apply as a new consumer migration after message_outbox.core.sql.
-- A lease is a dispatch permit, not permission to retry an uncertain send.
CREATE TABLE IF NOT EXISTS message_outbox_attempts (
  outbox_id TEXT NOT NULL REFERENCES message_outbox(id) ON DELETE CASCADE,
  attempt_number INTEGER NOT NULL CHECK (attempt_number > 0),
  status TEXT NOT NULL CHECK (
    status IN ('CLAIMED', 'DISPATCHING', 'SENT', 'FAILED', 'SKIPPED', 'EXPIRED', 'UNKNOWN')
  ),
  lease_expires_at INTEGER NOT NULL,
  dispatch_started_at INTEGER,
  finished_at INTEGER,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (outbox_id, attempt_number)
) STRICT;

CREATE INDEX IF NOT EXISTS idx_message_outbox_attempts_expiry
  ON message_outbox_attempts(lease_expires_at)
  WHERE status IN ('CLAIMED', 'DISPATCHING');
