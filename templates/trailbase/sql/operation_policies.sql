-- Private server authority. No row means all mutations are disabled.
CREATE TABLE IF NOT EXISTS operation_policies (
  feature TEXT PRIMARY KEY CHECK (feature IN ('iap','promotion','smart-message','app-reward')),
  revision INTEGER NOT NULL CHECK (revision > 0),
  allow_entry INTEGER NOT NULL CHECK (allow_entry IN (0,1)),
  allow_dispatch INTEGER NOT NULL CHECK (allow_dispatch IN (0,1)),
  allow_settlement INTEGER NOT NULL CHECK (allow_settlement IN (0,1)),
  updated_at INTEGER NOT NULL CHECK (updated_at >= 0),
  expires_at INTEGER NOT NULL CHECK (expires_at > updated_at)
) STRICT;
