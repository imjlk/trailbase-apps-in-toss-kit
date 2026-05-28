CREATE TABLE IF NOT EXISTS message_templates (
  template_code TEXT PRIMARY KEY,
  purpose TEXT NOT NULL CHECK (purpose IN ('FUNCTIONAL', 'MARKETING')),
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'APPROVED', 'PAUSED', 'RETIRED')),
  requires_agreement INTEGER NOT NULL DEFAULT 0 CHECK (requires_agreement IN (0, 1)),
  agreement_template_code TEXT CHECK (
    agreement_template_code IS NULL
    OR length(trim(agreement_template_code)) > 0
  ),
  default_deeplink_path TEXT,
  cooldown_ms INTEGER NOT NULL DEFAULT 60000 CHECK (cooldown_ms >= 0),
  daily_limit INTEGER CHECK (daily_limit IS NULL OR daily_limit > 0),
  title_preview TEXT,
  body_preview TEXT,
  notes TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (requires_agreement = 0 OR agreement_template_code IS NOT NULL)
) STRICT;

CREATE INDEX IF NOT EXISTS idx_message_templates_purpose_status
  ON message_templates(purpose, status);

CREATE INDEX IF NOT EXISTS idx_message_templates_agreement_template_code
  ON message_templates(agreement_template_code)
  WHERE agreement_template_code IS NOT NULL;
