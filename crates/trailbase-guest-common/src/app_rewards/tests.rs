use super::*;
use rusqlite::{Connection, params_from_iter};

impl RewardDatabase for Connection {
    fn query_reward(&mut self, sql: &str, values: &[Value]) -> ApiResult<Vec<Vec<Value>>> {
        Ok(crate::sql_test_support::query(self, sql, values)
            .into_iter()
            .map(|row| {
                row.into_iter()
                    .map(|v| match v {
                        rusqlite::types::Value::Null => Value::Null,
                        rusqlite::types::Value::Integer(v) => Value::Integer(v),
                        rusqlite::types::Value::Real(v) => Value::Real(v),
                        rusqlite::types::Value::Text(v) => Value::Text(v),
                        rusqlite::types::Value::Blob(v) => Value::Blob(v),
                    })
                    .collect()
            })
            .collect())
    }
    fn execute_reward(&mut self, sql: &str, values: &[Value]) -> ApiResult<u64> {
        let values: Vec<rusqlite::types::Value> = values
            .iter()
            .map(|v| match v {
                Value::Null => rusqlite::types::Value::Null,
                Value::Integer(v) => (*v).into(),
                Value::Real(v) => (*v).into(),
                Value::Text(v) => v.clone().into(),
                Value::Blob(v) => v.clone().into(),
            })
            .collect();
        self.execute(sql, params_from_iter(values))
            .map(|n| n as u64)
            .map_err(|_| internal("SQLite write failed"))
    }
}
fn database() -> Connection {
    let db = Connection::open_in_memory().unwrap();
    db.execute_batch("PRAGMA foreign_keys=ON; CREATE TABLE _user(id BLOB PRIMARY KEY); INSERT INTO _user VALUES (X'01'),(X'02');").unwrap();
    db.execute_batch(include_str!(
        "../../../../templates/trailbase/sql/app_reward_attempts.sql"
    ))
    .unwrap();
    db
}
fn offer() -> AppRewardOffer {
    AppRewardOffer {
        policy_version: "v1".into(),
        unit: "coin".into(),
        amount: 10,
        ttl_ms: 1000,
    }
}
fn issue(db: &mut Connection) -> AppRewardAttempt {
    issue_attempt(db, &[1], "daily", AppRewardSource::Ad, 100, |_| Ok(offer())).unwrap()
}
fn count(db: &Connection) -> i64 {
    db.query_row("SELECT count(*) FROM app_reward_grants", [], |row| {
        row.get(0)
    })
    .unwrap()
}

#[test]
fn duplicate_claim_returns_original_credit_after_expiry_and_skips_policy() {
    let mut db = database();
    let attempt = issue(&mut db);
    let first = claim_attempt(&mut db, &[1], "daily", &attempt.id, 200, |_, stored| {
        assert_eq!(stored.reward_amount, 10);
        assert_eq!(stored.policy_version, "v1");
        Ok(true)
    })
    .unwrap();
    let replay = claim_attempt(&mut db, &[1], "daily", &attempt.id, 5000, |_, _| {
        panic!("replay must not run policy")
    })
    .unwrap();
    assert_eq!(first, replay);
    assert_eq!(count(&db), 1);
    assert_eq!(
        find_attempt(&mut db, &[1], "daily", &attempt.id).unwrap(),
        Some(first)
    );
}

#[test]
fn wrong_owner_placement_expiry_and_server_policy_never_credit() {
    let mut db = database();
    let attempt = issue(&mut db);
    for (user, placement, now) in [
        (&[2][..], "daily", 200),
        (&[1][..], "other", 200),
        (&[1][..], "daily", 1100),
    ] {
        assert!(
            claim_attempt(&mut db, user, placement, &attempt.id, now, |_, _| panic!(
                "invalid context reached policy"
            ))
            .is_err()
        );
    }
    assert_eq!(
        claim_attempt(&mut db, &[1], "daily", &attempt.id, 200, |_, _| Ok(false))
            .unwrap_err()
            .code,
        "REWARD_INELIGIBLE"
    );
    assert!(
        find_attempt(&mut db, &[2], "daily", &attempt.id)
            .unwrap()
            .is_none()
    );
    assert_eq!(count(&db), 0);
}

#[test]
fn credit_and_consumer_projection_roll_back_together() {
    let mut db = database();
    let attempt = issue(&mut db);
    db.execute_batch("CREATE TABLE projection(amount INTEGER CHECK(amount<5)); BEGIN IMMEDIATE;")
        .unwrap();
    claim_attempt(&mut db, &[1], "daily", &attempt.id, 200, |_, _| Ok(true)).unwrap();
    assert!(
        db.execute("INSERT INTO projection VALUES (10)", [])
            .is_err()
    );
    db.execute_batch("ROLLBACK").unwrap();
    assert_eq!(count(&db), 0);
    claim_attempt(&mut db, &[1], "daily", &attempt.id, 201, |_, _| Ok(true)).unwrap();
    assert_eq!(count(&db), 1);
}

#[test]
fn server_quota_prevents_crediting_a_second_attempt() {
    let mut db = database();
    let first = issue(&mut db);
    let second = issue(&mut db);
    let policy = |db: &mut Connection, _: &AppRewardAttempt| Ok(count(db) < 1);
    db.execute_batch("BEGIN IMMEDIATE").unwrap();
    claim_attempt(&mut db, &[1], "daily", &first.id, 200, policy).unwrap();
    db.execute_batch("COMMIT; BEGIN IMMEDIATE").unwrap();
    assert!(claim_attempt(&mut db, &[1], "daily", &second.id, 201, policy).is_err());
    db.execute_batch("ROLLBACK").unwrap();
    assert_eq!(count(&db), 1);
}

#[test]
fn invalid_offer_denied_issue_and_clock_overflow_do_not_create_attempts() {
    let mut db = database();
    assert!(
        issue_attempt(
            &mut db,
            &[1],
            "daily",
            AppRewardSource::Share,
            100,
            |_| Err(forbidden("DENIED", "policy"))
        )
        .is_err()
    );
    assert!(
        issue_attempt(
            &mut db,
            &[1],
            "daily",
            AppRewardSource::Ad,
            i64::MAX,
            |_| Ok(offer())
        )
        .is_err()
    );
    for amount in [0, -1, 1_000_000_001] {
        assert!(
            issue_attempt(&mut db, &[1], "daily", AppRewardSource::Ad, 100, |_| Ok(
                AppRewardOffer { amount, ..offer() }
            ))
            .is_err()
        );
    }
    assert!(validate_id(&"z".repeat(48)).is_err());
    let total: i64 = db
        .query_row("SELECT count(*) FROM app_reward_attempts", [], |r| r.get(0))
        .unwrap();
    assert_eq!(total, 0);
}

#[test]
fn grant_unique_constraint_and_sql_time_fence_defend_duplicate_writes() {
    let mut db = database();
    let attempt = issue(&mut db);
    let mut params = scope_params(&[1], "daily", &attempt.id);
    params.push(Value::Integer(99));
    assert_eq!(db.execute_reward(INSERT_GRANT, &params).unwrap(), 0);
    params[3] = Value::Integer(200);
    assert_eq!(db.execute_reward(INSERT_GRANT, &params).unwrap(), 1);
    assert_eq!(db.execute_reward(INSERT_GRANT, &params).unwrap(), 0);
    // Account erasure remains possible; consumers decide retention before erasing.
    db.execute("DELETE FROM _user WHERE id=X'01'", []).unwrap();
    assert_eq!(count(&db), 0);
}
