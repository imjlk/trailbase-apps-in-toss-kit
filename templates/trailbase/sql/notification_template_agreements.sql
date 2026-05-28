CREATE TABLE IF NOT EXISTS notification_template_agreements (
  id TEXT PRIMARY KEY,
  user_id BLOB NOT NULL REFERENCES _user(id) ON DELETE CASCADE,
  agreement_template_code TEXT NOT NULL CHECK (length(trim(agreement_template_code)) > 0),
  status TEXT NOT NULL CHECK (status IN ('OPTED_IN', 'OPTED_OUT')),
  source TEXT NOT NULL,
  last_result TEXT CHECK (
    last_result IS NULL
    OR last_result IN ('newAgreement', 'alreadyAgreed', 'agreementRejected')
  ),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (user_id, agreement_template_code)
) STRICT;

CREATE INDEX IF NOT EXISTS idx_notification_template_agreements_agreement_status
  ON notification_template_agreements(agreement_template_code, status);

CREATE INDEX IF NOT EXISTS idx_notification_template_agreements_user_updated
  ON notification_template_agreements(user_id, updated_at DESC);
