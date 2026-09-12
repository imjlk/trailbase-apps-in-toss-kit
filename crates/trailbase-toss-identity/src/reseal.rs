//! Bounded private maintenance batches for the kit's identity table templates.
//! Commit the returned cursor in the same transaction; roll back every error.
use crate::TossIdentityKeyRing;
use trailbase_guest_common::responses::{ApiResult, bad_request, conflict, internal};
use trailbase_guest_common::toss_identity_store::TOSS_IDENTITY_REVOKED_SEALED_TOMBSTONE;
use trailbase_wasm::db::{Transaction, Value};

#[derive(Clone, Copy)]
pub enum IdentityCiphertextTable {
    Toss,
    Anonymous,
}
impl IdentityCiphertextTable {
    fn scan_params(self, after: Option<&str>, limit: usize) -> Vec<Value> {
        let mut params = vec![
            after.map(|v| Value::Text(v.into())).unwrap_or(Value::Null),
            Value::Integer(limit as i64),
        ];
        if matches!(self, Self::Toss) {
            params.push(Value::Text(TOSS_IDENTITY_REVOKED_SEALED_TOMBSTONE.into()));
        }
        params
    }
    fn queries(self) -> (&'static str, &'static str) {
        match self {
            Self::Toss => (
                "SELECT id,toss_user_key_sealed FROM toss_identities WHERE toss_user_key_sealed IS NOT NULL AND NOT (status='REVOKED' AND toss_user_key_sealed=?3) AND (?1 IS NULL OR id>?1) ORDER BY id LIMIT ?2",
                "UPDATE toss_identities SET toss_user_key_sealed=?3 WHERE id=?1 AND toss_user_key_sealed=?2",
            ),
            Self::Anonymous => (
                "SELECT anonymous_hash_hmac,anonymous_key_sealed FROM anonymous_identities WHERE (?1 IS NULL OR anonymous_hash_hmac>?1) ORDER BY anonymous_hash_hmac LIMIT ?2",
                "UPDATE anonymous_identities SET anonymous_key_sealed=?3 WHERE anonymous_hash_hmac=?1 AND anonymous_key_sealed=?2",
            ),
        }
    }
}

// No Debug/Serialize: the anonymous cursor is itself a private HMAC lookup value.
pub struct IdentityResealProgress {
    pub examined: usize,
    pub rewritten: usize,
    pub next_cursor: Option<String>,
    pub complete: bool,
}

/// Uses the current writer key without touching HMAC, ownership, revocation or
/// business timestamps. All readers must support v2 before enabling this job.
/// Stop old-format writers, retain old keys for backups and repeat a full sweep
/// after writer cutover. A cursor is only progress, not proof that all rows migrated.
pub fn reseal_identity_batch_tx(
    tx: &mut Transaction,
    table: IdentityCiphertextTable,
    ring: &TossIdentityKeyRing,
    after: Option<&str>,
    limit: usize,
) -> ApiResult<IdentityResealProgress> {
    if !(1..=100).contains(&limit) || after.is_some_and(|id| id.len() > 1024) {
        return Err(bad_request(
            "INVALID_RESEAL_BATCH",
            "Invalid identity reseal batch bounds",
        ));
    }
    let (select, update) = table.queries();
    let rows = tx
        .query(select, &table.scan_params(after, limit))
        .map_err(|_| internal("Identity reseal rows could not be read"))?;
    // Authenticate/prepare the whole batch before changing any row.
    let prepared = prepare(&rows, |sealed| ring.reseal_if_needed(sealed))?;
    for (id, original, replacement) in &prepared.updates {
        let changed = tx
            .execute(
                update,
                &[
                    Value::Text(id.clone()),
                    Value::Text(original.clone()),
                    Value::Text(replacement.clone()),
                ],
            )
            .map_err(|_| internal("Identity reseal write failed"))?;
        if changed != 1 {
            return Err(conflict(
                "RESEAL_CONFLICT",
                "Identity changed during reseal; roll back and retry from the saved cursor",
            ));
        }
    }
    Ok(IdentityResealProgress {
        examined: rows.len(),
        rewritten: prepared.updates.len(),
        next_cursor: prepared.last_id.or_else(|| after.map(str::to_owned)),
        complete: rows.len() < limit,
    })
}

struct Prepared {
    updates: Vec<(String, String, String)>,
    last_id: Option<String>,
}
fn prepare(
    rows: &[Vec<Value>],
    mut reseal: impl FnMut(&str) -> Result<Option<String>, String>,
) -> ApiResult<Prepared> {
    let mut updates = Vec::new();
    let mut last_id = None;
    for row in rows {
        let [Value::Text(id), Value::Text(original)] = row.as_slice() else {
            return Err(internal("Invalid identity reseal row"));
        };
        if let Some(replacement) = reseal(original)
            .map_err(|_| internal("Identity ciphertext could not be authenticated for reseal"))?
        {
            updates.push((id.clone(), original.clone(), replacement));
        }
        last_id = Some(id.clone());
    }
    Ok(Prepared { updates, last_id })
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::{Connection, params, params_from_iter};
    fn scan_params(table: IdentityCiphertextTable) -> Vec<rusqlite::types::Value> {
        table
            .scan_params(None, 100)
            .into_iter()
            .map(|v| match v {
                Value::Null => rusqlite::types::Value::Null,
                Value::Integer(v) => v.into(),
                Value::Text(v) => v.into(),
                _ => unreachable!(),
            })
            .collect()
    }
    #[test]
    fn prepare_authenticates_current_rows_and_redacts_failures() {
        let rows = vec![vec![
            Value::Text("private-id".into()),
            Value::Text("ciphertext".into()),
        ]];
        let error = prepare(&rows, |_| Err("PRIVATE-CANARY".into()))
            .err()
            .unwrap();
        assert!(!error.message.contains("PRIVATE-CANARY"));
        let unchanged = prepare(&rows, |_| Ok(None)).unwrap();
        assert!(unchanged.updates.is_empty());
        assert_eq!(unchanged.last_id.as_deref(), Some("private-id"));
        assert!(prepare(&[vec![]], |_| Ok(None)).is_err());
    }
    #[test]
    fn compare_and_swap_preserves_newer_ciphertexts_lookup_and_revocation() {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch("PRAGMA foreign_keys=ON; CREATE TABLE _user(id BLOB PRIMARY KEY); INSERT INTO _user VALUES (X'01');").unwrap();
        db.execute_batch(include_str!(
            "../../../templates/trailbase/sql/toss_identities.sql"
        ))
        .unwrap();
        db.execute_batch(include_str!(
            "../../../templates/trailbase/sql/anonymous_identities.sql"
        ))
        .unwrap();
        db.execute("INSERT INTO toss_identities VALUES ('row',X'01','private-hmac','old','DEFAULT','[]','REVOKED',1,2,3,'UNLINK',1,4)", []).unwrap();
        db.execute(
            "INSERT INTO anonymous_identities VALUES ('private-hmac',X'01','old',1,4,3)",
            [],
        )
        .unwrap();
        db.execute("INSERT INTO toss_identities VALUES ('a-tombstone',X'01','erased-hmac',?1,'DEFAULT','[]','REVOKED',1,2,3,'UNLINK',1,4)", [TOSS_IDENTITY_REVOKED_SEALED_TOMBSTONE]).unwrap();
        for (table, id) in [
            (IdentityCiphertextTable::Toss, "row"),
            (IdentityCiphertextTable::Anonymous, "private-hmac"),
        ] {
            let (select, update) = table.queries();
            let values: (String, String) = db
                .query_row(select, params_from_iter(scan_params(table)), |r| {
                    Ok((r.get(0)?, r.get(1)?))
                })
                .unwrap();
            assert_eq!(values, (id.into(), "old".into()));
            db.execute_batch("BEGIN IMMEDIATE").unwrap();
            assert_eq!(db.execute(update, params![id, "old", "new"]).unwrap(), 1);
            db.execute_batch("ROLLBACK").unwrap();
            assert_eq!(
                db.execute(update, params![id, "old", "concurrent"])
                    .unwrap(),
                1
            );
            assert_eq!(
                db.execute(update, params![id, "old", "stale-replacement"])
                    .unwrap(),
                0
            );
            assert_eq!(
                db.query_row(select, params_from_iter(scan_params(table)), |r| r
                    .get::<_, String>(1))
                    .unwrap(),
                "concurrent"
            );
        }
        assert_eq!(
            db.query_row(
                "SELECT toss_user_key_hmac,status,updated_at FROM toss_identities WHERE id='row'",
                [],
                |r| Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, i64>(2)?
                ))
            )
            .unwrap(),
            ("private-hmac".into(), "REVOKED".into(), 4)
        );
        assert_eq!(
            db.query_row(
                "SELECT anonymous_hash_hmac,revoked_at,updated_at FROM anonymous_identities",
                [],
                |r| Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, i64>(1)?,
                    r.get::<_, i64>(2)?
                ))
            )
            .unwrap(),
            ("private-hmac".into(), 3, 4)
        );
        db.execute(
            "UPDATE toss_identities SET status='ACTIVE' WHERE id='a-tombstone'",
            [],
        )
        .unwrap();
        let table = IdentityCiphertextTable::Toss;
        let selected: String = db
            .query_row(
                table.queries().0,
                params_from_iter(scan_params(table)),
                |r| r.get(1),
            )
            .unwrap();
        assert_eq!(selected, TOSS_IDENTITY_REVOKED_SEALED_TOMBSTONE);
    }
}
