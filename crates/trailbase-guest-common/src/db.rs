use crate::responses::{ApiError, ApiResult, internal, not_found};
use trailbase_wasm::db::{Transaction, Value, query};

pub fn text(value: &Value, column: &'static str) -> ApiResult<String> {
    match value {
        Value::Text(v) => Ok(v.clone()),
        Value::Null => Err(not_found("NOT_FOUND", format!("Missing {column}"))),
        _ => Err(internal(format!("Unexpected type for {column}"))),
    }
}

pub fn integer(value: &Value, column: &'static str) -> ApiResult<i64> {
    match value {
        Value::Integer(v) => Ok(*v),
        _ => Err(internal(format!("Unexpected type for {column}"))),
    }
}

pub fn real(value: &Value, column: &'static str) -> ApiResult<f64> {
    match value {
        Value::Real(v) => Ok(*v),
        Value::Integer(v) => Ok(*v as f64),
        _ => Err(internal(format!("Unexpected type for {column}"))),
    }
}

pub fn blob(value: &Value, column: &'static str) -> ApiResult<Vec<u8>> {
    match value {
        Value::Blob(v) => Ok(v.clone()),
        _ => Err(internal(format!("Unexpected type for {column}"))),
    }
}

pub fn nullable_text(value: &Value) -> ApiResult<Option<String>> {
    match value {
        Value::Text(v) => Ok(Some(v.clone())),
        Value::Null => Ok(None),
        _ => Err(internal("Unexpected nullable text type")),
    }
}

pub fn nullable_integer(value: &Value) -> ApiResult<Option<i64>> {
    match value {
        Value::Integer(v) => Ok(Some(*v)),
        Value::Null => Ok(None),
        _ => Err(internal("Unexpected nullable integer type")),
    }
}

pub fn tx() -> ApiResult<Transaction> {
    Transaction::begin().map_err(|err| internal(format!("Failed to begin transaction: {err}")))
}

pub fn tx_query(tx: &mut Transaction, sql: &str, params: &[Value]) -> ApiResult<Vec<Vec<Value>>> {
    tx.query(sql, params)
        .map_err(|err| internal(format!("Database query failed: {err}")))
}

pub fn tx_execute(tx: &mut Transaction, sql: &str, params: &[Value]) -> ApiResult<u64> {
    tx.execute(sql, params)
        .map_err(|err| internal(format!("Database execute failed: {err}")))
}

pub fn tx_commit(tx: &mut Transaction) -> ApiResult<()> {
    tx.commit()
        .map_err(|err| internal(format!("Database commit failed: {err}")))
}

pub fn now_ms_tx(tx: &mut Transaction) -> ApiResult<i64> {
    let rows = tx_query(
        tx,
        "SELECT CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)",
        &[],
    )?;
    integer(&rows[0][0], "now_ms")
}

pub async fn now_ms() -> ApiResult<i64> {
    let rows = query_rows(
        "SELECT CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)",
        [],
    )
    .await?;
    integer(&rows[0][0], "now_ms")
}

pub fn date_key_tx(tx: &mut Transaction, now_ms: i64) -> ApiResult<String> {
    let rows = tx_query(
        tx,
        "SELECT strftime('%Y-%m-%d', ?1 / 1000, 'unixepoch')",
        &[Value::Integer(now_ms)],
    )?;
    text(&rows[0][0], "date_key")
}

pub async fn query_rows(
    sql: &str,
    params: impl Into<Vec<Value>>,
) -> Result<Vec<Vec<Value>>, ApiError> {
    let params = params.into();
    let mut last_error = None;
    for attempt in 0..3 {
        match query(sql, params.clone()).await {
            Ok(rows) => return Ok(rows),
            Err(err) if attempt < 2 && is_transient_db_error(&err) => {
                last_error = Some(err.to_string());
            }
            Err(err) => return Err(internal(format!("Database query failed: {err}"))),
        }
    }
    Err(internal(format!(
        "Database query failed: {}",
        last_error.unwrap_or_else(|| "transient database read timeout".to_string())
    )))
}

fn is_transient_db_error(err: &impl ToString) -> bool {
    let message = err.to_string();
    message.contains("ConnectionReadTimeout") || message.contains("ConnectionReset")
}
