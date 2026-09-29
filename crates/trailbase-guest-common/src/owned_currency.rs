//! Private accounting mirror. Call within the same transaction as the app ledger.
//! Never commit here or use an inserted report event as authorization to grant money.
use crate::{
    db,
    responses::{ApiResult, bad_request, conflict},
};
use sha2::{Digest, Sha256};
use trailbase_wasm::db::{Transaction, Value};

#[derive(Debug, Clone)]
pub struct CurrencyEvent<'a> {
    /// Globally scoped immutable source-event key; never a provider/user identity.
    pub key: &'a str,
    pub user_id: Option<&'a [u8]>,
    pub currency: &'a str,
    pub unit: &'a str,
    pub kind: &'a str,
    pub quantity: i64,
    pub source_type: &'a str,
    pub source_id: &'a str,
    pub policy: &'a str,
    pub exchange_id: Option<&'a str>,
    pub occurred_at: i64,
    pub valuation: Option<(i64, &'a str)>,
}
/// Exact replay is accepted, conflicting reuse rejected. Returns true only for insertion.
/// Event timestamps use milliseconds; created_at is captured from the database clock.
/// Caller owns eligibility, balance mutation, rollback on errors, and commit.
pub fn record_event_tx(tx: &mut Transaction, event: &CurrencyEvent<'_>) -> ApiResult<bool> {
    let recorded_at = db::now_ms_tx(tx)?;
    record_with(event, recorded_at, |sql, params| {
        Ok(!db::tx_query(tx, sql, params)?.is_empty())
    })
}
fn record_with(
    event: &CurrencyEvent<'_>,
    recorded_at: i64,
    mut query: impl FnMut(&str, &[Value]) -> ApiResult<bool>,
) -> ApiResult<bool> {
    let mut params = event_params(event)?;
    params.push(Value::Integer(recorded_at));
    params.push(Value::Text(hex::encode(Sha256::digest(
        event.key.as_bytes(),
    ))));
    if query(INSERT, &params)? {
        return Ok(true);
    }
    if query(REPLAY, &params[..13])? {
        return Ok(false);
    }
    if query(
        "SELECT id FROM owned_currency_events WHERE idempotency_key=?1",
        &params[..1],
    )? {
        return Err(conflict(
            "CURRENCY_EVENT_CONFLICT",
            "Conflicting accounting event",
        ));
    }
    if query(
        "SELECT 1 FROM owned_currency_policies WHERE currency_code=?1 AND unit_code=?2 AND policy_version=?3 AND effective_from<=?4 AND (effective_to IS NULL OR effective_to>?4)",
        &[
            params[2].clone(),
            params[3].clone(),
            params[8].clone(),
            params[10].clone(),
        ],
    )? {
        return Err(bad_request(
            "CURRENCY_VALUATION_MISMATCH",
            "Valuation does not match the effective policy",
        ));
    }
    Err(crate::responses::ApiError::new(
        trailbase_wasm::http::StatusCode::INTERNAL_SERVER_ERROR,
        "CURRENCY_POLICY_NOT_EFFECTIVE",
        "No effective policy for this accounting event",
    ))
}

const INSERT: &str = "INSERT INTO owned_currency_events
(id,user_id,currency_code,unit_code,event_type,quantity,source_type,source_id,idempotency_key,policy_version,exchange_id,occurred_at,created_at,valuation_amount,valuation_currency_code)
SELECT ?15,?2,?3,?4,?5,?6,?7,?8,?1,?9,?10,?11,?14,?12,?13
WHERE EXISTS (SELECT 1 FROM owned_currency_policies WHERE currency_code=?3 AND unit_code=?4 AND policy_version=?9 AND effective_from<=?11 AND (effective_to IS NULL OR effective_to>?11)
AND (?12 IS NULL OR (valuation_mode <> 'NONE' AND valuation_currency_code IS ?13))
AND (valuation_mode <> 'MARKET_SNAPSHOT' OR ?5 <> 'EXCHANGE' OR ?12 IS NOT NULL))
ON CONFLICT(idempotency_key) DO NOTHING RETURNING id";
const REPLAY: &str = "SELECT id FROM owned_currency_events WHERE idempotency_key=?1
AND user_id IS ?2 AND currency_code=?3 AND unit_code=?4 AND event_type=?5 AND quantity=?6
AND source_type=?7 AND source_id=?8 AND policy_version=?9 AND exchange_id IS ?10 AND occurred_at=?11 AND valuation_amount IS ?12 AND valuation_currency_code IS ?13";
fn event_params(e: &CurrencyEvent<'_>) -> ApiResult<Vec<Value>> {
    let valid_text = |s: &str, max: usize| !s.is_empty() && s.len() <= max && s.trim() == s;
    if !valid_text(e.key, 256)
        || !valid_text(e.source_type, 64)
        || !valid_text(e.source_id, 256)
        || !valid_text(e.policy, 64)
        || e.valuation.is_some_and(|(amount, code)| {
            amount < 0
                || !valid_text(code, 64)
                || !code
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || b"._-".contains(&c))
        })
        || e.quantity == 0
        || e.occurred_at < 0
        || !["ISSUE", "SPEND", "EXCHANGE", "EXPIRE", "ADJUSTMENT"].contains(&e.kind)
        || (e.kind == "ISSUE" && e.quantity < 0)
        || (["SPEND", "EXCHANGE", "EXPIRE"].contains(&e.kind) && e.quantity > 0)
        || (e.kind == "EXCHANGE" && e.exchange_id.is_none())
        || e.exchange_id.is_some_and(|s| !valid_text(s, 256))
        || [e.currency, e.unit].iter().any(|s| {
            !valid_text(s, 64)
                || !s
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || b"._-".contains(&c))
        })
    {
        return Err(bad_request(
            "INVALID_CURRENCY_EVENT",
            "Invalid accounting event",
        ));
    }
    let text = |s: &str| Value::Text(s.to_owned());
    Ok(vec![
        text(e.key),
        e.user_id
            .map(|s| Value::Blob(s.to_vec()))
            .unwrap_or(Value::Null),
        text(e.currency),
        text(e.unit),
        text(e.kind),
        Value::Integer(e.quantity),
        text(e.source_type),
        text(e.source_id),
        text(e.policy),
        e.exchange_id.map(text).unwrap_or(Value::Null),
        Value::Integer(e.occurred_at),
        e.valuation
            .map(|v| Value::Integer(v.0))
            .unwrap_or(Value::Null),
        e.valuation.map(|v| text(v.1)).unwrap_or(Value::Null),
    ])
}
#[cfg(all(test, not(target_arch = "wasm32")))]
mod tests {
    use super::*;
    use crate::sql_test_support::{execute, query};
    fn event() -> CurrencyEvent<'static> {
        CurrencyEvent {
            key: "app:source:1",
            user_id: Some(&[1]),
            currency: "STAR",
            unit: "STAR",
            kind: "ISSUE",
            quantity: 10,
            source_type: "ledger",
            source_id: "1",
            policy: "v1",
            exchange_id: None,
            occurred_at: 10,
            valuation: None,
        }
    }
    #[test]
    fn policy_replay_conflict_and_rollback() {
        let db = crate::sql_test_support::database();
        db.execute_batch(include_str!(
            "../../../templates/trailbase/sql/owned_currency_events.sql"
        ))
        .unwrap();
        db.execute_batch(include_str!(
            "../../../templates/trailbase/sql/owned_currency_policies.sql"
        ))
        .unwrap();
        let mut e = event();
        let run = |e: &CurrencyEvent<'_>| {
            record_with(
                e,
                100,
                |sql, params| Ok(!query(&db, sql, params).is_empty()),
            )
        };
        assert_eq!(run(&e).unwrap_err().code, "CURRENCY_POLICY_NOT_EFFECTIVE");
        db.execute_batch("INSERT INTO owned_currency_policies(currency_code,unit_code,policy_version,valuation_mode,valuation_currency_code,conversion_numerator,conversion_denominator,effective_from,created_at) VALUES ('STAR','STAR','v1','FIXED_RATE','KRW',1,10,0,0); BEGIN;").unwrap();
        assert!(run(&e).unwrap());
        assert!(!run(&e).unwrap());
        assert_eq!(
            db.query_row("SELECT created_at FROM owned_currency_events", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            100
        );
        e.quantity = 11;
        assert_eq!(run(&e).unwrap_err().code, "CURRENCY_EVENT_CONFLICT");
        execute(&db, "ROLLBACK", &[]);
        assert_eq!(
            db.query_row("SELECT count(*) FROM owned_currency_events", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            0
        );
    }
    #[test]
    fn valuation_contract_and_long_keys() {
        let db = crate::sql_test_support::database();
        db.execute_batch(include_str!(
            "../../../templates/trailbase/sql/owned_currency_events.sql"
        ))
        .unwrap();
        db.execute_batch(include_str!(
            "../../../templates/trailbase/sql/owned_currency_policies.sql"
        ))
        .unwrap();
        db.execute_batch("INSERT INTO owned_currency_policies(currency_code,unit_code,policy_version,valuation_mode,valuation_currency_code,effective_from,created_at) VALUES ('STAR','STAR','v1','MARKET_SNAPSHOT','KRW',0,0)").unwrap();
        let run = |e: &CurrencyEvent<'_>| {
            record_with(
                e,
                100,
                |sql, params| Ok(!query(&db, sql, params).is_empty()),
            )
        };
        let key = "x".repeat(256);
        let mut e = event();
        e.key = &key;
        assert!(run(&e).unwrap());
        assert!(!run(&e).unwrap());
        e.key = "exchange";
        e.kind = "EXCHANGE";
        e.quantity = -10;
        e.exchange_id = Some("ex");
        assert_eq!(run(&e).unwrap_err().code, "CURRENCY_VALUATION_MISMATCH");
        e.valuation = Some((1, "USD"));
        assert_eq!(run(&e).unwrap_err().code, "CURRENCY_VALUATION_MISMATCH");
        e.valuation = Some((1, "KRW"));
        assert!(run(&e).unwrap());
        // Existing rows with the former key-as-ID representation still replay.
        db.execute_batch(
            "UPDATE owned_currency_events SET id=idempotency_key WHERE idempotency_key='exchange'",
        )
        .unwrap();
        assert!(!run(&e).unwrap());
        e.key = "none";
        db.execute_batch(
            "UPDATE owned_currency_policies SET valuation_mode='NONE',valuation_currency_code=NULL",
        )
        .unwrap();
        assert_eq!(run(&e).unwrap_err().code, "CURRENCY_VALUATION_MISMATCH");
        e.valuation = None;
        assert!(run(&e).unwrap());
        let oversized = "x".repeat(257);
        e.key = &oversized;
        assert_eq!(run(&e).unwrap_err().code, "INVALID_CURRENCY_EVENT");
    }
    #[test]
    fn rejects_invalid_events() {
        let mut e = event();
        e.kind = "EXCHANGE";
        assert!(event_params(&e).is_err());
        e.kind = "ISSUE";
        e.quantity = -1;
        assert!(event_params(&e).is_err());
        e.quantity = 1;
        e.key = " bad ";
        assert!(event_params(&e).is_err());
    }
}
