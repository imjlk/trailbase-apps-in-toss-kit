CREATE TABLE IF NOT EXISTS message_templates (
  template_code TEXT PRIMARY KEY,
  purpose TEXT NOT NULL CHECK (purpose IN ('FUNCTIONAL', 'MARKETING')),
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'APPROVED', 'PAUSED', 'RETIRED')),
  requires_agreement INTEGER NOT NULL DEFAULT 0 CHECK (requires_agreement IN (0, 1)),
  default_deeplink_path TEXT,
  cooldown_ms INTEGER NOT NULL DEFAULT 60000 CHECK (cooldown_ms >= 0),
  daily_limit INTEGER CHECK (daily_limit IS NULL OR daily_limit > 0),
  title_preview TEXT,
  body_preview TEXT,
  notes TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_message_templates_purpose_status
  ON message_templates(purpose, status);
