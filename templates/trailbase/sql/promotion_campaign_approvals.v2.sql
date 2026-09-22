-- Forward migration for consumers that copied the first promotion approval
-- template before the close-evidence constraints were added.
--
-- Run this once in an authenticated migration process after inspecting the
-- existing rows. It preserves rows and fails closed when existing evidence
-- violates the new invariants. New consumers should use
-- promotion_campaign_approvals.sql instead.
DROP TABLE IF EXISTS promotion_campaign_approvals_v2;
CREATE TABLE promotion_campaign_approvals_v2 (
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
  CONSTRAINT chk_decided_requires_reviewed_at CHECK (
    recorded_approval_status IN ('UNCONFIRMED', 'PENDING')
    OR reviewed_at IS NOT NULL
  ),
  CONSTRAINT chk_decided_requires_evidence CHECK (
    recorded_approval_status IN ('UNCONFIRMED', 'PENDING')
    OR (approved_config_revision IS NOT NULL AND approval_reference IS NOT NULL)
  ),
  CONSTRAINT chk_unconfirmed_classification CHECK (
    classification <> 'UNCONFIRMED'
    OR recorded_approval_status IN ('UNCONFIRMED', 'PENDING')
  ),
  CONSTRAINT chk_owned_currency_requires_reporting CHECK (
    classification <> 'OWNED_CURRENCY'
    OR monthly_reporting_required = 1
  )
) STRICT;

INSERT INTO promotion_campaign_approvals_v2 (
  campaign_id,
  revision,
  classification,
  recorded_approval_status,
  approved_config_revision,
  approval_reference,
  monthly_reporting_required,
  reviewed_at,
  created_at
)
SELECT
  campaign_id,
  revision,
  classification,
  recorded_approval_status,
  approved_config_revision,
  approval_reference,
  monthly_reporting_required,
  reviewed_at,
  created_at
FROM promotion_campaign_approvals;

DROP TABLE promotion_campaign_approvals;
ALTER TABLE promotion_campaign_approvals_v2 RENAME TO promotion_campaign_approvals;

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

CREATE TRIGGER IF NOT EXISTS trg_promotion_campaign_approvals_append_only_update
BEFORE UPDATE ON promotion_campaign_approvals
BEGIN
  SELECT RAISE(ABORT, 'promotion_campaign_approvals revisions are append-only');
END;

CREATE TRIGGER IF NOT EXISTS trg_promotion_campaign_approvals_append_only_delete
BEFORE DELETE ON promotion_campaign_approvals
BEGIN
  SELECT RAISE(ABORT, 'promotion_campaign_approvals revisions are append-only');
END;
