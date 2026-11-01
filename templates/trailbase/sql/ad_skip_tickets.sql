-- Private app-owned ad skip tickets. Do not expose any table through Record API.
-- A ticket skips one in-app full-screen ad. It is not transferable, sellable or
-- convertible to cash or Toss points, and it never uses the promotion ledger.

-- Server balance projection. Account erasure forfeits the remaining balance.
CREATE TABLE IF NOT EXISTS ad_skip_ticket_wallets (
  user_id BLOB PRIMARY KEY REFERENCES _user(id) ON DELETE CASCADE,
  balance INTEGER NOT NULL CHECK (balance >= 0),
  updated_at INTEGER NOT NULL CHECK (updated_at >= 0)
) STRICT;

-- One row per granted cause period, such as a local attendance day or a completed
-- streak cycle. subject_hash outlives the account so the same identity cannot earn
-- the same or an overlapping period again after re-joining.
CREATE TABLE IF NOT EXISTS ad_skip_ticket_grants (
  id INTEGER PRIMARY KEY,
  user_id BLOB REFERENCES _user(id) ON DELETE SET NULL,
  subject_hash TEXT NOT NULL CHECK (length(subject_hash) = 64),
  cause TEXT NOT NULL CHECK (length(cause) BETWEEN 1 AND 64),
  period_start INTEGER NOT NULL,
  period_end INTEGER NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 1000),
  policy_version TEXT NOT NULL CHECK (length(policy_version) BETWEEN 1 AND 64),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  CHECK (period_end >= period_start),
  UNIQUE (subject_hash, cause, period_start, period_end)
) STRICT;

-- Exactly one resolution per ad opportunity: a watched ad, a ticket or a free pass.
CREATE TABLE IF NOT EXISTS ad_skip_opportunities (
  user_id BLOB NOT NULL REFERENCES _user(id) ON DELETE CASCADE,
  placement TEXT NOT NULL CHECK (length(placement) BETWEEN 1 AND 64),
  opportunity_key TEXT NOT NULL CHECK (length(opportunity_key) BETWEEN 1 AND 128),
  resolution TEXT NOT NULL CHECK (resolution IN ('AD', 'TICKET', 'FREE')),
  reference TEXT NOT NULL CHECK (length(reference) BETWEEN 1 AND 128),
  resolved_at INTEGER NOT NULL CHECK (resolved_at >= 0),
  PRIMARY KEY (user_id, placement, opportunity_key)
) STRICT;

-- Redemption receipts. (user_id, request_id) is the client idempotency key.
CREATE TABLE IF NOT EXISTS ad_skip_ticket_redemptions (
  id TEXT PRIMARY KEY CHECK (length(id) = 48),
  user_id BLOB NOT NULL REFERENCES _user(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL CHECK (length(request_id) BETWEEN 16 AND 128),
  placement TEXT NOT NULL CHECK (length(placement) BETWEEN 1 AND 64),
  opportunity_key TEXT NOT NULL CHECK (length(opportunity_key) BETWEEN 1 AND 128),
  context TEXT NOT NULL CHECK (length(context) <= 128),
  resolution TEXT NOT NULL CHECK (resolution IN ('TICKET', 'FREE', 'ALREADY_RESOLVED')),
  consumed INTEGER NOT NULL CHECK (consumed IN (0, 1)),
  balance_after INTEGER NOT NULL CHECK (balance_after >= 0),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  CHECK ((consumed = 1) = (resolution = 'TICKET')),
  UNIQUE (user_id, request_id)
) STRICT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_ad_skip_ticket_redemptions_consumed_opportunity
  ON ad_skip_ticket_redemptions(user_id, placement, opportunity_key)
  WHERE consumed = 1;

CREATE INDEX IF NOT EXISTS idx_ad_skip_ticket_grants_owner
  ON ad_skip_ticket_grants(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ad_skip_ticket_grants_subject_period
  ON ad_skip_ticket_grants(subject_hash, cause, period_end);
