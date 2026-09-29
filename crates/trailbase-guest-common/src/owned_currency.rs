//! Private accounting mirror. Call within the same transaction as the app ledger.
//! Never commit here or use an inserted report event as authorization to grant money.
use crate::{
    db,
    responses::{ApiResult, bad_request, conflict},
};
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
/// Caller owns eligibility, balance mutation, rollback on errors, and commit.
pub fn record_event_tx(tx: &mut Transaction, event: &CurrencyEvent<'_>) -> ApiResult<bool> {
    let params = event_params(event)?;
    let inserted = db::tx_query(tx, INSERT, &params)?;
    if !inserted.is_empty() {
        return Ok(true);
    }
    if db::tx_query(tx, REPLAY, &params)?.is_empty() {
        return Err(conflict(
            "CURRENCY_EVENT_CONFLICT",
            "Missing policy or conflicting accounting event",
        ));
    }
    Ok(false)
}
const INSERT: &str = "INSERT INTO owned_currency_events
(id,user_id,currency_code,unit_code,event_type,quantity,source_type,source_id,idempotency_key,policy_version,exchange_id,occurred_at,created_at,valuation_amount,valuation_currency_code)
SELECT ?1,?2,?3,?4,?5,?6,?7,?8,?1,?9,?10,?11,?11,?12,?13
WHERE EXISTS (SELECT 1 FROM owned_currency_policies WHERE currency_code=?3 AND unit_code=?4 AND policy_version=?9 AND effective_from<=?11 AND (effective_to IS NULL OR effective_to>?11))
ON CONFLICT(idempotency_key) DO NOTHING RETURNING id";
const REPLAY: &str = "SELECT id FROM owned_currency_events WHERE idempotency_key=?1
AND user_id IS ?2 AND currency_code=?3 AND unit_code=?4 AND event_type=?5 AND quantity=?6
AND source_type=?7 AND source_id=?8 AND policy_version=?9 AND exchange_id IS ?10 AND occurred_at=?11 AND valuation_amount IS ?12 AND valuation_currency_code IS ?13";
fn event_params(e: &CurrencyEvent<'_>) -> ApiResult<Vec<Value>> {
    let valid_text = |s: &str, max: usize| !s.is_empty() && s.len() <= max && s.trim() == s;
    if !valid_text(e.key, 128)
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
        assert!(query(&db, INSERT, &event_params(&e).unwrap()).is_empty());
        db.execute_batch("INSERT INTO owned_currency_policies(currency_code,unit_code,policy_version,valuation_mode,valuation_currency_code,conversion_numerator,conversion_denominator,effective_from,created_at) VALUES ('STAR','STAR','v1','FIXED_RATE','KRW',1,10,0,0); BEGIN;").unwrap();
        assert_eq!(query(&db, INSERT, &event_params(&e).unwrap()).len(), 1);
        assert!(query(&db, INSERT, &event_params(&e).unwrap()).is_empty());
        assert_eq!(query(&db, REPLAY, &event_params(&e).unwrap()).len(), 1);
        e.quantity = 11;
        assert!(query(&db, REPLAY, &event_params(&e).unwrap()).is_empty());
        execute(&db, "ROLLBACK", &[]);
        assert_eq!(
            db.query_row("SELECT count(*) FROM owned_currency_events", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            0
        );
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
