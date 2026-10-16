-- Additive, repeatable index migration for existing v2 promotion ledgers.
-- Apply after promotion_reward_ledger.v2.sql; fresh installs use the core template.
-- Preserves all existing rows, keys, execution markers, and provider outcomes.
CREATE INDEX IF NOT EXISTS idx_promotion_reward_ledger_unexecuted
  ON promotion_reward_ledger(updated_at, id)
  WHERE protocol = 'three-step'
    AND status = 'pending'
    AND execution_started_at IS NULL;
