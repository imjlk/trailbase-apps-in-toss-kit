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
--                         helper; keyless rows settle the same way through
--                         explicit reconciliation and are never adopted.
--   execution_started_at persisted execution-start marker, committed
--                         atomically BEFORE the external execute call and
--                         never cleared or reset afterwards.
--
-- This migration is additive only: existing grant rows, transaction keys,
-- user/source/campaign links, and provider outcomes are preserved. Do not
-- guess execution facts: a legacy row whose execution state is unknown must
-- stay unmarked. In particular, never re-store a key onto a legacy row that
-- already holds one to "restart" it: the library fences that (a same-key
-- re-store only applies to three-step rows), because such a row may already
-- have reached the provider and re-executing it can double-grant.
--
-- The whole file runs inside one SAVEPOINT: standalone application
-- (sqlite3 CLI, execute_batch, db.exec) gets full-transaction semantics —
-- the outermost savepoint starts an implicit transaction that the RELEASE
-- commits — while a migration runner that already wraps each file in its
-- own transaction nests cleanly instead of failing with "cannot start a
-- transaction within a transaction". On failure, issue ROLLBACK TO (or
-- close the connection) before retrying, because a failed batch leaves
-- the savepoint open on that handle. When using the sqlite3 CLI, run with
-- bail-on-errors so a mid-file failure stops before the trailing RELEASE:
-- `sqlite3 --bail ledger.db ".read promotion_reward_ledger.v2.sql"` — a
-- plain ".read" without bail keeps going after an error and would release
-- the partial work. Set PRAGMA busy_timeout first or apply during a
-- quiesced window: without a busy handler the write lock is not waited
-- for, and never concatenate this file with other migration SQL.
SAVEPOINT promotion_reward_ledger_v2;

-- No protocol backfill runs here. A pending row with a stored key and
-- provider_status 'PREPARED' is NOT provably pre-execution: the 0.11
-- store-key fence (a89e2b0) admitted provider_status IN ('PENDING',
-- 'PREPARED'), so an executed-then-PENDING row that saw a same-key store
-- replay could also read 'PREPARED' — adopting such a row here would make
-- it v2-claimable and re-executable (a double grant). Every legacy row
-- therefore stays unmarked. Drain BEFORE upgrading, while the 0.11 helpers
-- still run:
--   * PREPARED rows (key stored): PREPARED cannot distinguish a never-
--     executed key from the executed-then-PENDING state a same-key store
--     replay produced, so these rows reconcile through the STATUS LOOKUP
--     ONLY (never the 0.11 resume path — that would re-execute a reward
--     the provider may already have applied).
--   * EXECUTING / unsettled PENDING / SUBMITTED / UNKNOWN rows: status
--     lookup with the stored key plus the outcome-apply helper.
--   * Keyless rows (including PREPARED-without-key) are NEVER adopted: a
--     legacy grant that executed but crashed before the caller persisted
--     its key leaves exactly this shape, indistinguishable from a
--     never-dispatched row. Settle them through explicit reconciliation —
--     the v2 key store only accepts rows the v2 flow itself created.
ALTER TABLE promotion_reward_ledger ADD COLUMN protocol TEXT
  CHECK (protocol IS NULL OR protocol IN ('three-step'));

ALTER TABLE promotion_reward_ledger ADD COLUMN execution_started_at INTEGER;

CREATE INDEX IF NOT EXISTS idx_promotion_reward_ledger_recovery
  ON promotion_reward_ledger(execution_started_at)
  WHERE protocol = 'three-step'
    AND status = 'pending'
    AND provider_transaction_key IS NOT NULL;

RELEASE promotion_reward_ledger_v2;