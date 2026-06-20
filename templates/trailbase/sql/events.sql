CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  screen TEXT,
  source TEXT,
  props_json TEXT NOT NULL DEFAULT '{}' CHECK (
    json_valid(props_json)
    AND json_type(props_json) = 'object'
  ),
  user_id BLOB,
  client_at INTEGER NOT NULL,
  server_at INTEGER NOT NULL,
  request_id TEXT,
  batch_id TEXT
) STRICT;

CREATE INDEX IF NOT EXISTS idx_events_server_at
  ON events(server_at DESC);

CREATE INDEX IF NOT EXISTS idx_events_name_server_at
  ON events(name, server_at DESC);
