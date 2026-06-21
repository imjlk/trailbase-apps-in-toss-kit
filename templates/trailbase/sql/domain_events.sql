CREATE TABLE IF NOT EXISTS app_events (
  id INTEGER PRIMARY KEY,
  user_id TEXT,
  event_name TEXT NOT NULL CHECK (length(trim(event_name)) > 0),
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
  source_type TEXT,
  source_id_json TEXT CHECK (
    source_id_json IS NULL
    OR json_valid(source_id_json)
  ),
  request_id TEXT,
  created_at INTEGER NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_app_events_user_created
  ON app_events(user_id, created_at DESC)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_app_events_name_created
  ON app_events(event_name, created_at DESC);
