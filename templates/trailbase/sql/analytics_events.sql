CREATE TABLE IF NOT EXISTS analytics_events (
  id INTEGER PRIMARY KEY,
  event_name TEXT NOT NULL CHECK (length(trim(event_name)) > 0),
  screen TEXT,
  source TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}' CHECK (
    json_valid(payload_json)
    AND json_type(payload_json) = 'object'
  ),
  user_id BLOB,
  client_created_at INTEGER NOT NULL,
  server_received_at INTEGER NOT NULL,
  request_id TEXT,
  batch_id TEXT
) STRICT;

CREATE INDEX IF NOT EXISTS idx_analytics_events_name_received
  ON analytics_events(event_name, server_received_at DESC);

CREATE INDEX IF NOT EXISTS idx_analytics_events_user_received
  ON analytics_events(user_id, server_received_at DESC)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_analytics_events_batch
  ON analytics_events(batch_id, server_received_at DESC)
  WHERE batch_id IS NOT NULL;
