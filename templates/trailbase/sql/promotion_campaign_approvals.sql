-- Private operator-entered approval evidence for promotion_campaigns.
-- Do not expose this table through the Record API or infer approval from an
-- SDK call, a test promotion, or a provider response.
--
-- Copy this template into a consumer migration and keep each revision. An
-- approval revision is separate from an owned-currency policy_version.
CREATE TABLE IF NOT EXISTS promotion_campaign_approvals (
  campaign_id TEXT NOT NULL REFERENCES promotion_campaigns(id) ON DELETE RESTRICT,
  revision INTEGER NOT NULL CHECK (revision > 0),
  classification TEXT NOT NULL CHECK (
    classification IN ('UNCONFIRMED', 'DIRECT_REWARD', 'OWNED_CURRENCY', 'OTHER')
  ),
  recorded_approval_status TEXT NOT NULL CHECK (
    recorded_approval_status IN ('UNCONFIRMED', 'PENDING', 'APPROVED', 'REJECTED', 'EXPIRED')
  ),
  approved_config_revision TEXT CHECK (
    approved_config_revision IS NULL
    OR (
    length(trim(approved_config_revision, ' ' || char(9) || char(10) || char(13))) BETWEEN 1 AND 128
    AND approved_config_revision = trim(approved_config_revision, ' ' || char(9) || char(10) || char(13))
    )
  ),
  approval_reference TEXT CHECK (
    approval_reference IS NULL
    OR (
      length(trim(approval_reference, ' ' || char(9) || char(10) || char(13))) BETWEEN 1 AND 256
      AND approval_reference = trim(approval_reference, ' ' || char(9) || char(10) || char(13))
    )
  ),
  monthly_reporting_required INTEGER NOT NULL CHECK (monthly_reporting_required IN (0, 1)),
  reviewed_at INTEGER CHECK (reviewed_at IS NULL OR reviewed_at >= 0),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  PRIMARY KEY (campaign_id, revision),
  CHECK (
    recorded_approval_status IN ('UNCONFIRMED', 'PENDING')
    OR reviewed_at IS NOT NULL
  ),
  CHECK (
    recorded_approval_status IN ('UNCONFIRMED', 'PENDING')
    OR (approved_config_revision IS NOT NULL AND approval_reference IS NOT NULL)
  ),
  CHECK (
    classification <> 'UNCONFIRMED'
    OR recorded_approval_status IN ('UNCONFIRMED', 'PENDING')
  ),
  CHECK (
    classification <> 'OWNED_CURRENCY'
    OR monthly_reporting_required = 1
  )
) STRICT;

CREATE INDEX IF NOT EXISTS idx_promotion_campaign_approvals_latest
  ON promotion_campaign_approvals(campaign_id, revision DESC);

CREATE INDEX IF NOT EXISTS idx_promotion_campaign_approvals_reporting
  ON promotion_campaign_approvals(monthly_reporting_required, recorded_approval_status, revision DESC);

CREATE TRIGGER IF NOT EXISTS trg_promotion_campaign_approvals_monotonic
BEFORE INSERT ON promotion_campaign_approvals
WHEN NEW.revision <= (
  SELECT COALESCE(MAX(revision), 0)
  FROM promotion_campaign_approvals
  WHERE campaign_id = NEW.campaign_id
)
BEGIN
  SELECT RAISE(ABORT, 'promotion_campaign_approvals revisions must be appended in increasing order');
END;
