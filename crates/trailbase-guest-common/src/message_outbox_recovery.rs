//! Optional dispatch leases. Apply message_outbox_attempts.sql before using these APIs.
//! Commit a dispatch permit before making the network call; never hold a DB
//! transaction across it. An expired in-flight send is quarantined, not retried.
use trailbase_wasm::db::{Transaction, Value};

use crate::apps_in_toss_messages::{
    MessageOutboxRecord, MessageProviderResponse, claim_ready_message_outbox_tx,
    complete_message_outbox_tx, skip_message_outbox_tx,
};
use crate::db;
use crate::responses::{ApiResult, bad_request};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MessageOutboxAttempt {
    pub outbox: MessageOutboxRecord,
    pub lease_expires_at: i64,
}

const INSERT_ATTEMPT: &str = "INSERT INTO message_outbox_attempts
    (outbox_id, attempt_number, status, lease_expires_at, created_at)
    VALUES (?1, ?2, 'CLAIMED', ?3, ?4)";

const START_DISPATCH: &str = "UPDATE message_outbox_attempts
    SET status = 'DISPATCHING', dispatch_started_at = ?3
    WHERE outbox_id = ?1 AND attempt_number = ?2
      AND status = 'CLAIMED' AND lease_expires_at > ?3
      AND EXISTS (SELECT 1 FROM message_outbox o WHERE o.id = outbox_id
        AND o.attempts = attempt_number AND o.status = 'LOCKED')";

const FINISH_ATTEMPT: &str = "UPDATE message_outbox_attempts
    SET status = ?4, finished_at = ?3
    WHERE outbox_id = ?1 AND attempt_number = ?2
      AND status = ?5 AND lease_expires_at > ?3
      AND EXISTS (SELECT 1 FROM message_outbox o WHERE o.id = outbox_id
        AND o.attempts = attempt_number AND o.status = 'LOCKED')";

const RECOVER_OUTBOX: &str = "UPDATE message_outbox
    SET status = CASE WHEN EXISTS (SELECT 1 FROM message_outbox_attempts a
          WHERE a.outbox_id = message_outbox.id AND a.attempt_number = attempts
            AND a.status = 'CLAIMED') THEN 'READY' ELSE 'FAILED' END,
        provider_status = CASE WHEN EXISTS (SELECT 1 FROM message_outbox_attempts a
          WHERE a.outbox_id = message_outbox.id AND a.attempt_number = attempts
            AND a.status = 'CLAIMED') THEN NULL ELSE 'UNKNOWN' END,
        failure_reason = CASE WHEN EXISTS (SELECT 1 FROM message_outbox_attempts a
          WHERE a.outbox_id = message_outbox.id AND a.attempt_number = attempts
            AND a.status = 'CLAIMED') THEN NULL ELSE 'Delivery outcome unknown after lease expiry' END,
        locked_at = NULL, updated_at = ?1
    WHERE status = 'LOCKED' AND EXISTS (SELECT 1 FROM message_outbox_attempts a
      WHERE a.outbox_id = message_outbox.id AND a.attempt_number = attempts
        AND a.status IN ('CLAIMED', 'DISPATCHING') AND a.lease_expires_at <= ?1)";

const EXPIRE_ATTEMPTS: &str = "UPDATE message_outbox_attempts
    SET status = CASE WHEN status = 'CLAIMED' THEN 'EXPIRED' ELSE 'UNKNOWN' END,
        finished_at = ?1
    WHERE status IN ('CLAIMED', 'DISPATCHING') AND lease_expires_at <= ?1";

const QUARANTINE_LEGACY: &str = "UPDATE message_outbox
    SET status = 'FAILED', provider_status = 'UNKNOWN', locked_at = NULL,
        failure_reason = 'Legacy dispatch outcome unknown', updated_at = ?2
    WHERE status = 'LOCKED' AND locked_at <= ?1
      AND NOT EXISTS (SELECT 1 FROM message_outbox_attempts a
        WHERE a.outbox_id = message_outbox.id AND a.attempt_number = attempts)";

pub fn claim_message_outbox_with_lease_tx(
    tx: &mut Transaction,
    limit: i64,
    now: i64,
    lease_duration_ms: i64,
) -> ApiResult<Vec<MessageOutboxAttempt>> {
    let expires = now
        .checked_add(lease_duration_ms)
        .filter(|end| *end > now)
        .ok_or_else(|| {
            bad_request(
                "INVALID_MESSAGE_LEASE",
                "lease duration must be positive and not overflow",
            )
        })?;
    let outbox = claim_ready_message_outbox_tx(tx, limit, now)?;
    let mut attempts = Vec::with_capacity(outbox.len());
    for row in outbox {
        db::tx_execute(
            tx,
            INSERT_ATTEMPT,
            &[
                Value::Text(row.id.clone()),
                Value::Integer(row.attempts),
                Value::Integer(expires),
                Value::Integer(now),
            ],
        )?;
        attempts.push(MessageOutboxAttempt {
            outbox: row,
            lease_expires_at: expires,
        });
    }
    Ok(attempts)
}

/// Recheck the app's dispatch gate, then commit this permit before sending.
/// False means the worker no longer owns this attempt and must not send.
pub fn begin_message_outbox_dispatch_tx(
    tx: &mut Transaction,
    attempt: &MessageOutboxAttempt,
    now: i64,
) -> ApiResult<bool> {
    crate::operation_policy::enforce_configured_operation_tx(
        tx,
        crate::operation_policy::OperationFeature::SmartMessage,
        crate::operation_policy::OperationPhase::Dispatch,
    )?;
    Ok(db::tx_execute(tx, START_DISPATCH, &attempt_params(attempt, now))? == 1)
}

/// False means a late response was fenced out. Retain it for reconciliation in
/// the consumer; do not create a new send or overwrite the quarantined outcome.
pub fn complete_message_outbox_attempt_tx(
    tx: &mut Transaction,
    attempt: &MessageOutboxAttempt,
    response: &MessageProviderResponse,
    raw_response_json: Option<&str>,
    now: i64,
) -> ApiResult<bool> {
    if response.provider_request_id != attempt.outbox.provider_request_id {
        return Err(bad_request(
            "MESSAGE_ATTEMPT_MISMATCH",
            "provider request does not match the claimed message",
        ));
    }
    let mut params = attempt_params(attempt, now);
    params.push(Value::Text(
        if response.is_sent() { "SENT" } else { "FAILED" }.into(),
    ));
    params.push(Value::Text("DISPATCHING".into()));
    if db::tx_execute(tx, FINISH_ATTEMPT, &params)? != 1 {
        return Ok(false);
    }
    complete_message_outbox_tx(tx, &attempt.outbox.id, response, raw_response_json, now)?;
    Ok(true)
}

/// Skip only before dispatch, for example when notification agreement is absent.
pub fn skip_message_outbox_attempt_tx(
    tx: &mut Transaction,
    attempt: &MessageOutboxAttempt,
    reason: &str,
    now: i64,
) -> ApiResult<bool> {
    let mut params = attempt_params(attempt, now);
    params.extend([Value::Text("SKIPPED".into()), Value::Text("CLAIMED".into())]);
    if db::tx_execute(tx, FINISH_ATTEMPT, &params)? != 1 {
        return Ok(false);
    }
    skip_message_outbox_tx(tx, &attempt.outbox.id, reason, now)?;
    Ok(true)
}

/// Requeue only attempts that never received a dispatch permit. A send whose
/// result was lost stays FAILED/UNKNOWN for explicit operator reconciliation.
pub fn recover_expired_message_outbox_attempts_tx(
    tx: &mut Transaction,
    now: i64,
) -> ApiResult<u64> {
    let params = [Value::Integer(now)];
    let updated = db::tx_execute(tx, RECOVER_OUTBOX, &params)?;
    db::tx_execute(tx, EXPIRE_ATTEMPTS, &params)?;
    Ok(updated)
}

/// Use during worker migration after stopping legacy dispatchers. Legacy locks
/// have no evidence that dispatch did not start, so they can never be auto-retried.
pub fn quarantine_legacy_message_outbox_locks_tx(
    tx: &mut Transaction,
    locked_before: i64,
    now: i64,
) -> ApiResult<u64> {
    db::tx_execute(
        tx,
        QUARANTINE_LEGACY,
        &[Value::Integer(locked_before), Value::Integer(now)],
    )
}

fn attempt_params(attempt: &MessageOutboxAttempt, now: i64) -> Vec<Value> {
    vec![
        Value::Text(attempt.outbox.id.clone()),
        Value::Integer(attempt.outbox.attempts),
        Value::Integer(now),
    ]
}

#[cfg(all(test, not(target_arch = "wasm32")))]
mod tests {
    use super::*;
    use crate::sql_test_support::{database, insert_outbox};
    use rusqlite::params;

    fn seed(db: &rusqlite::Connection, id: &str, started: bool) {
        insert_outbox(db, id, "LOCKED", 1);
        db.execute(INSERT_ATTEMPT, params![id, 1, 100, 10]).unwrap();
        if started {
            assert_eq!(db.execute(START_DISPATCH, params![id, 1, 20]).unwrap(), 1);
        }
    }

    #[test]
    fn only_expired_unsent_attempts_are_requeued() {
        let db = database();
        seed(&db, "unsent", false);
        seed(&db, "inflight", true);
        assert_eq!(db.execute(RECOVER_OUTBOX, [99]).unwrap(), 0);
        assert_eq!(db.execute(RECOVER_OUTBOX, [100]).unwrap(), 2);
        db.execute(EXPIRE_ATTEMPTS, [100]).unwrap();
        let status = |id: &str| {
            db.query_row(
                "SELECT status, provider_status FROM message_outbox WHERE id=?1",
                [id],
                |r| Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?)),
            )
            .unwrap()
        };
        assert_eq!(status("unsent"), ("READY".into(), None));
        assert_eq!(
            status("inflight"),
            ("FAILED".into(), Some("UNKNOWN".into()))
        );
        assert_eq!(
            db.execute(START_DISPATCH, params!["unsent", 1, 101])
                .unwrap(),
            0
        );
        assert_eq!(
            db.execute(
                FINISH_ATTEMPT,
                params!["inflight", 1, 101, "SENT", "DISPATCHING"]
            )
            .unwrap(),
            0
        );
        assert_eq!(db.execute(RECOVER_OUTBOX, [101]).unwrap(), 0);
    }

    #[test]
    fn stale_attempts_cannot_finish_a_new_claim_or_dispatch_after_skip() {
        let db = database();
        seed(&db, "row", true);
        db.execute("UPDATE message_outbox SET attempts=2 WHERE id='row'", [])
            .unwrap();
        assert_eq!(
            db.execute(FINISH_ATTEMPT, params!["row", 1, 30, "SENT", "DISPATCHING"])
                .unwrap(),
            0
        );
        assert_eq!(db.execute(RECOVER_OUTBOX, [100]).unwrap(), 0);
        seed(&db, "skip", false);
        assert_eq!(
            db.execute(FINISH_ATTEMPT, params!["skip", 1, 30, "SKIPPED", "CLAIMED"])
                .unwrap(),
            1
        );
        assert_eq!(
            db.execute(START_DISPATCH, params!["skip", 1, 31]).unwrap(),
            0
        );
    }

    #[test]
    fn active_attempts_finish_once_and_terminal_outbox_rows_are_preserved() {
        let db = database();
        seed(&db, "row", true);
        assert_eq!(
            db.execute(FINISH_ATTEMPT, params!["row", 1, 30, "SENT", "DISPATCHING"])
                .unwrap(),
            1
        );
        assert_eq!(
            db.execute(
                FINISH_ATTEMPT,
                params!["row", 1, 31, "FAILED", "DISPATCHING"]
            )
            .unwrap(),
            0
        );
        for status in ["SENT", "FAILED", "SKIPPED", "CANCELLED"] {
            seed(&db, status, true);
            db.execute("UPDATE message_outbox SET status=?1 WHERE id=?1", [status])
                .unwrap();
        }
        assert_eq!(db.execute(RECOVER_OUTBOX, [100]).unwrap(), 0);
    }

    #[test]
    fn legacy_locks_are_quarantined_without_touching_leased_or_terminal_rows() {
        let db = database();
        insert_outbox(&db, "legacy", "LOCKED", 1);
        insert_outbox(&db, "sent", "SENT", 1);
        seed(&db, "leased", true);
        assert_eq!(db.execute(QUARANTINE_LEGACY, params![9, 50]).unwrap(), 0);
        assert_eq!(db.execute(QUARANTINE_LEGACY, params![10, 50]).unwrap(), 1);
        assert_eq!(
            db.query_row(
                "SELECT provider_status FROM message_outbox WHERE id='legacy'",
                [],
                |r| r.get::<_, String>(0)
            )
            .unwrap(),
            "UNKNOWN"
        );
    }
}
