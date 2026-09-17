-- Explicit v2 upgrade for the promotion reward ledger (breaking change).
-- Apply once to an existing install that created the table from an older
-- promotion_reward_ledger.sql; fresh installs get these columns from the
-- core template and must NOT run this file.
--
-- What v2 adds:
--   protocol             'three-step' for rows created by the persisted
--                         prepare -> store -> execute -> status contract;
--                         NULL marks rows written by the removed legacy
--                         grant flow. Legacy rows are never adopted by
--                         recovery: in-flight rows (stored key, unsettled
--                         provider status such as EXECUTING/PENDING/UNKNOWN)
--                         must be drained via an operator-driven status
--                         lookup with the stored key plus the outcome-apply
--                         helper; keyless pending rows may be adopted by an
--                         explicit prepare + key store.
--   execution_started_at persisted execution-start marker, committed
--                         atomically BEFORE the external execute call and
--                         never cleared or reset afterwards.
--
-- This migration is additive only: existing grant rows, transaction keys,
-- user/source/campaign links, and provider outcomes are preserved. Do not
-- backfill protocol or execution_started_at — a legacy row's execution
-- facts are unknown and must stay unmarked rather than guessed. In
-- particular, never re-store a key onto a legacy row that already holds
-- one to "restart" it: the library fences that (a same-key re-store only
-- applies to three-step rows), because such a row may already have reached
-- the provider and re-executing it can double-grant.
ALTER TABLE promotion_reward_ledger ADD COLUMN protocol TEXT
  CHECK (protocol IS NULL OR protocol IN ('three-step'));

ALTER TABLE promotion_reward_ledger ADD COLUMN execution_started_at INTEGER;

CREATE INDEX IF NOT EXISTS idx_promotion_reward_ledger_recovery
  ON promotion_reward_ledger(execution_started_at)
  WHERE protocol = 'three-step'
    AND status = 'pending'
    AND provider_transaction_key IS NOT NULL;
