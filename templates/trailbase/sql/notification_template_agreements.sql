CREATE TABLE IF NOT EXISTS notification_template_agreements (
  id TEXT PRIMARY KEY,
  user_id BLOB NOT NULL REFERENCES _user(id) ON DELETE CASCADE,
  template_code TEXT NOT NULL REFERENCES message_templates(template_code) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('OPTED_IN', 'OPTED_OUT')),
  source TEXT NOT NULL,
  last_result TEXT CHECK (
    last_result IS NULL
    OR last_result IN ('newAgreement', 'alreadyAgreed', 'agreementRejected')
  ),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (user_id, template_code)
) STRICT;

CREATE INDEX IF NOT EXISTS idx_notification_template_agreements_template_status
  ON notification_template_agreements(template_code, status);

CREATE INDEX IF NOT EXISTS idx_notification_template_agreements_user_updated
  ON notification_template_agreements(user_id, updated_at DESC);
