-- Private snapshot of a point reward condition met inside an eligibility window.
-- It keeps the campaign, provider code, amount and first-claim deadline that applied
-- when the condition was met. It neither reserves budget nor proves payment:
-- promotion_reward_ledger still records provider grants. Do not expose it through
-- Record API. The subject hash outlives the account so a re-joined identity cannot
-- earn the same period twice; apply the app's retention policy explicitly.
CREATE TABLE IF NOT EXISTS promotion_reward_eligibilities (
  id TEXT PRIMARY KEY CHECK (length(id) = 48),
  user_id BLOB REFERENCES _user(id) ON DELETE SET NULL,
  subject_hash TEXT NOT NULL CHECK (length(subject_hash) = 64),
  reward_kind TEXT NOT NULL CHECK (length(reward_kind) BETWEEN 1 AND 64),
  period_start INTEGER NOT NULL,
  period_end INTEGER NOT NULL,
  campaign_id TEXT NOT NULL REFERENCES promotion_campaigns(id),
  provider_promotion_code TEXT NOT NULL CHECK (length(trim(provider_promotion_code)) > 0),
  reward_amount INTEGER NOT NULL CHECK (reward_amount > 0),
  basis TEXT NOT NULL CHECK (basis IN ('WELCOME', 'LEGACY_GRACE')),
  policy_version TEXT NOT NULL CHECK (length(policy_version) BETWEEN 1 AND 64),
  earned_at INTEGER NOT NULL CHECK (earned_at >= 0),
  -- Exclusive end of the first claim. Status checks of an existing claim are separate.
  claim_deadline_at INTEGER NOT NULL,
  claim_ledger_id TEXT UNIQUE CHECK (claim_ledger_id IS NULL OR length(claim_ledger_id) BETWEEN 1 AND 128),
  claimed_at INTEGER,
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  CHECK (period_end >= period_start),
  CHECK (claim_deadline_at > earned_at),
  CHECK ((claimed_at IS NULL) = (claim_ledger_id IS NULL)),
  UNIQUE (subject_hash, reward_kind, period_start, period_end)
) STRICT;

CREATE INDEX IF NOT EXISTS idx_promotion_reward_eligibilities_owner
  ON promotion_reward_eligibilities(user_id, earned_at DESC);

CREATE INDEX IF NOT EXISTS idx_promotion_reward_eligibilities_subject_period
  ON promotion_reward_eligibilities(subject_hash, reward_kind, period_end);
