CREATE TABLE IF NOT EXISTS message_outbox (
  id TEXT PRIMARY KEY,
  user_id BLOB NOT NULL REFERENCES _user(id) ON DELETE CASCADE,
  toss_user_key_hmac TEXT NOT NULL,
  toss_user_key_sealed TEXT,
  campaign_id TEXT,
  purpose TEXT NOT NULL CHECK (purpose IN ('FUNCTIONAL', 'MARKETING')),
  template_code TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'READY' CHECK (
    status IN ('READY', 'LOCKED', 'SENT', 'FAILED', 'SKIPPED', 'CANCELLED')
  ),
  provider TEXT NOT NULL DEFAULT 'TOSS_SMART_MESSAGE',
  provider_request_id TEXT NOT NULL,
  provider_status TEXT,
  provider_result_type TEXT,
  provider_msg_count INTEGER,
  provider_sent_push_count INTEGER,
  provider_sent_inbox_count INTEGER,
  provider_response_json TEXT CHECK (
    provider_response_json IS NULL
    OR json_valid(provider_response_json)
  ),
  attempts INTEGER NOT NULL DEFAULT 0,
  not_before_at INTEGER NOT NULL,
  locked_at INTEGER,
  sent_at INTEGER,
  failed_at INTEGER,
  failure_reason TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (idempotency_key)
) STRICT;

CREATE INDEX IF NOT EXISTS idx_message_outbox_ready_dispatch
  ON message_outbox(not_before_at, created_at)
  WHERE status = 'READY';

CREATE INDEX IF NOT EXISTS idx_message_outbox_user_created
  ON message_outbox(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_message_outbox_toss_user_key_hmac
  ON message_outbox(toss_user_key_hmac);

CREATE UNIQUE INDEX IF NOT EXISTS idx_message_outbox_provider_request
  ON message_outbox(provider, provider_request_id)
  WHERE provider_request_id IS NOT NULL;
