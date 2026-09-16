use rusqlite::{Connection, params_from_iter};
use trailbase_wasm::db::Value;

pub fn database() -> Connection {
    let db = Connection::open_in_memory().unwrap();
    db.execute_batch("PRAGMA foreign_keys = ON; CREATE TABLE _user (id BLOB PRIMARY KEY) STRICT; INSERT INTO _user VALUES (X'01');").unwrap();
    db.execute_batch(include_str!(
        "../../../templates/trailbase/sql/message_outbox.core.sql"
    ))
    .unwrap();
    db.execute_batch(include_str!(
        "../../../templates/trailbase/sql/message_outbox_attempts.sql"
    ))
    .unwrap();
    db.execute_batch(include_str!(
        "../../../templates/trailbase/sql/iap_orders.sql"
    ))
    .unwrap();
    db.execute_batch(include_str!(
        "../../../templates/trailbase/sql/promotion_campaigns.sql"
    ))
    .unwrap();
    db.execute_batch(include_str!(
        "../../../templates/trailbase/sql/promotion_reward_ledger.sql"
    ))
    .unwrap();
    db
}

fn to_rusqlite_params(params: &[Value]) -> Vec<rusqlite::types::Value> {
    params
        .iter()
        .map(|value| match value {
            Value::Null => rusqlite::types::Value::Null,
            Value::Integer(v) => (*v).into(),
            Value::Real(v) => (*v).into(),
            Value::Text(v) => v.clone().into(),
            Value::Blob(v) => v.clone().into(),
        })
        .collect()
}

pub fn query(db: &Connection, sql: &str, params: &[Value]) -> Vec<Vec<rusqlite::types::Value>> {
    let mut statement = db.prepare(sql).unwrap();
    let count = statement.column_count();
    statement
        .query_map(params_from_iter(to_rusqlite_params(params)), |row| {
            (0..count).map(|i| row.get(i)).collect()
        })
        .unwrap()
        .map(Result::unwrap)
        .collect()
}

pub fn execute(db: &Connection, sql: &str, params: &[Value]) -> usize {
    db.execute(sql, params_from_iter(to_rusqlite_params(params)))
        .unwrap()
}

pub fn insert_outbox(db: &Connection, id: &str, status: &str, attempts: i64) {
    db.execute(
        "INSERT INTO message_outbox
        (id,user_id,toss_user_key_hmac,purpose,template_code,payload_json,idempotency_key,
         provider_request_id,status,attempts,not_before_at,locked_at,created_at,updated_at)
        VALUES (?1,X'01','hmac','FUNCTIONAL','reminder','{}',?1,?1,?2,?3,0,10,0,10)",
        rusqlite::params![id, status, attempts],
    )
    .unwrap();
}
