use serde::{Deserialize, Serialize};
use trailbase_wasm::db::{Transaction, Value};

use crate::db;
use crate::responses::{ApiResult, internal, unauthorized};

pub const TOSS_IDENTITY_REVOKED_SEALED_TOMBSTONE: &str = "REVOKED";
pub const TOSS_LOGIN_REQUIRED_CODE: &str = "TOSS_LOGIN_REQUIRED";
pub const TOSS_LOGIN_REQUIRED_MESSAGE: &str = "토스 로그인 후 이용할 수 있어요.";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SealedTossIdentity {
    pub hmac: String,
    pub sealed: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TossIdentityRow {
    pub id: String,
    pub user_id: String,
    pub toss_user_key_hmac: String,
    pub toss_user_key_sealed: Option<String>,
    pub referrer: String,
    pub linked_at: i64,
    pub last_seen_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthTossIdentityRow {
    pub id: String,
    pub user: Vec<u8>,
    pub toss_user_key_hmac: String,
    pub toss_user_key_sealed: Option<String>,
    pub referrer: String,
    pub linked_at: i64,
    pub last_seen_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TossIdentityRevokeResult {
    pub id: String,
    pub user_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthTossIdentityRevokeResult {
    pub id: String,
    pub user: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthTossIdentityUpsertResult {
    pub id: String,
    pub user: Vec<u8>,
    pub canonical_user_changed: bool,
}

pub fn active_toss_identity_tx(
    tx: &mut Transaction,
    user_id: &str,
) -> ApiResult<Option<TossIdentityRow>> {
    let (sql, params) = active_toss_identity_statement(user_id);
    let rows = db::tx_query(tx, sql, &params)?;
    rows.first()
        .map(|row| toss_identity_from_row(row))
        .transpose()
}

pub fn active_toss_identity_for_trailbase_user_tx(
    tx: &mut Transaction,
    user: &[u8],
) -> ApiResult<Option<AuthTossIdentityRow>> {
    let (sql, params) = active_toss_identity_for_trailbase_user_statement(user);
    let rows = db::tx_query(tx, sql, &params)?;
    rows.first()
        .map(|row| auth_toss_identity_from_row(row))
        .transpose()
}

pub fn require_active_toss_identity_tx(
    tx: &mut Transaction,
    user_id: &str,
) -> ApiResult<TossIdentityRow> {
    active_toss_identity_tx(tx, user_id)?.ok_or_else(|| {
        unauthorized(
            TOSS_LOGIN_REQUIRED_CODE,
            TOSS_LOGIN_REQUIRED_MESSAGE.to_string(),
        )
    })
}

pub fn require_active_toss_identity_for_trailbase_user_tx(
    tx: &mut Transaction,
    user: &[u8],
) -> ApiResult<AuthTossIdentityRow> {
    active_toss_identity_for_trailbase_user_tx(tx, user)?.ok_or_else(|| {
        unauthorized(
            TOSS_LOGIN_REQUIRED_CODE,
            TOSS_LOGIN_REQUIRED_MESSAGE.to_string(),
        )
    })
}

pub fn unseal_active_toss_user_key_tx(
    tx: &mut Transaction,
    user_id: &str,
    unseal: impl FnOnce(&str) -> Result<String, String>,
) -> ApiResult<String> {
    let identity = require_active_toss_identity_tx(tx, user_id)?;
    let sealed = identity
        .toss_user_key_sealed
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| internal("Active Toss identity is missing sealed userKey"))?;
    unseal(sealed.as_str()).map_err(|err| internal(format!("Failed to unseal Toss userKey: {err}")))
}

pub fn unseal_active_toss_user_key_for_trailbase_user_tx(
    tx: &mut Transaction,
    user: &[u8],
    unseal: impl FnOnce(&str) -> Result<String, String>,
) -> ApiResult<String> {
    let identity = require_active_toss_identity_for_trailbase_user_tx(tx, user)?;
    let sealed = identity
        .toss_user_key_sealed
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| internal("Active Toss identity is missing sealed userKey"))?;
    unseal(sealed.as_str()).map_err(|err| internal(format!("Failed to unseal Toss userKey: {err}")))
}

pub fn trailbase_user_for_toss_identity_hmac_tx(
    tx: &mut Transaction,
    toss_user_key_hmac: &str,
) -> ApiResult<Option<Vec<u8>>> {
    let (sql, params) = trailbase_user_for_toss_identity_hmac_statement(toss_user_key_hmac);
    let rows = db::tx_query(tx, sql, &params)?;
    rows.first()
        .map(|row| db::blob(&row[0], "trailbase_user"))
        .transpose()
}

pub fn upsert_toss_identity_tx(
    tx: &mut Transaction,
    user_id: &str,
    sealed_toss_identity: &SealedTossIdentity,
    referrer: &str,
    now: i64,
) -> ApiResult<()> {
    let (sql, params) =
        upsert_toss_identity_statement(user_id, sealed_toss_identity, referrer, now);
    db::tx_execute(tx, sql, &params)?;
    Ok(())
}

pub fn upsert_toss_identity_for_trailbase_user_tx(
    tx: &mut Transaction,
    user: &[u8],
    sealed_toss_identity: &SealedTossIdentity,
    referrer: &str,
    now: i64,
) -> ApiResult<AuthTossIdentityUpsertResult> {
    let (sql, params) = upsert_toss_identity_for_trailbase_user_statement(
        user,
        sealed_toss_identity,
        referrer,
        now,
    );
    let rows = db::tx_query(tx, sql, &params)?;
    let row = rows
        .first()
        .ok_or_else(|| internal("Failed to upsert Toss identity"))?;
    let canonical_user = db::blob(&row[1], "trailbase_user")?;
    Ok(AuthTossIdentityUpsertResult {
        id: db::text(&row[0], "toss_identity_id")?,
        canonical_user_changed: canonical_user.as_slice() != user,
        user: canonical_user,
    })
}

pub fn revoke_toss_identity_by_hmac_tx(
    tx: &mut Transaction,
    toss_user_key_hmac: &str,
    referrer: &str,
    now: i64,
) -> ApiResult<Option<TossIdentityRevokeResult>> {
    let (sql, params) = revoke_toss_identity_by_hmac_statement(toss_user_key_hmac, referrer, now);
    let rows = db::tx_query(tx, sql, &params)?;
    rows.first()
        .map(|row| {
            Ok(TossIdentityRevokeResult {
                id: db::text(&row[0], "toss_identity_id")?,
                user_id: db::text(&row[1], "user_id")?,
            })
        })
        .transpose()
}

pub fn revoke_toss_identity_by_hmac_for_trailbase_user_tx(
    tx: &mut Transaction,
    toss_user_key_hmac: &str,
    referrer: &str,
    now: i64,
) -> ApiResult<Option<AuthTossIdentityRevokeResult>> {
    let (sql, params) = revoke_toss_identity_by_hmac_for_trailbase_user_statement(
        toss_user_key_hmac,
        referrer,
        now,
    );
    let rows = db::tx_query(tx, sql, &params)?;
    rows.first()
        .map(|row| {
            Ok(AuthTossIdentityRevokeResult {
                id: db::text(&row[0], "toss_identity_id")?,
                user: db::blob(&row[1], "trailbase_user")?,
            })
        })
        .transpose()
}

pub fn touch_toss_identity_seen_tx(tx: &mut Transaction, user_id: &str, now: i64) -> ApiResult<()> {
    let (sql, params) = touch_toss_identity_seen_statement(user_id, now);
    db::tx_execute(tx, sql, &params)?;
    Ok(())
}

pub fn touch_toss_identity_seen_for_trailbase_user_tx(
    tx: &mut Transaction,
    user: &[u8],
    now: i64,
) -> ApiResult<()> {
    let (sql, params) = touch_toss_identity_seen_for_trailbase_user_statement(user, now);
    db::tx_execute(tx, sql, &params)?;
    Ok(())
}

pub fn normalize_nonempty(value: &str, fallback: &str) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        fallback.to_string()
    } else {
        trimmed.to_string()
    }
}

fn active_toss_identity_statement(user_id: &str) -> (&'static str, Vec<Value>) {
    (
        "SELECT id, user_id, toss_user_key_hmac, toss_user_key_sealed,
                referrer, linked_at, last_seen_at
         FROM toss_identities
         WHERE user_id = ?1
           AND status = 'ACTIVE'
         ORDER BY last_seen_at DESC, linked_at DESC
         LIMIT 1",
        vec![Value::Text(user_id.to_string())],
    )
}

fn active_toss_identity_for_trailbase_user_statement(user: &[u8]) -> (&'static str, Vec<Value>) {
    (
        "SELECT id, \"user\", toss_user_key_hmac, toss_user_key_sealed,
                referrer, linked_at, last_seen_at
         FROM toss_identities
         WHERE \"user\" = ?1
           AND status = 'ACTIVE'
         ORDER BY last_seen_at DESC, linked_at DESC
         LIMIT 1",
        vec![Value::Blob(user.to_vec())],
    )
}

fn trailbase_user_for_toss_identity_hmac_statement(
    toss_user_key_hmac: &str,
) -> (&'static str, Vec<Value>) {
    (
        "SELECT \"user\"
         FROM toss_identities
         WHERE toss_user_key_hmac = ?1
           AND status = 'ACTIVE'
         ORDER BY last_seen_at DESC, linked_at DESC
         LIMIT 1",
        vec![Value::Text(toss_user_key_hmac.to_string())],
    )
}

fn upsert_toss_identity_statement(
    user_id: &str,
    sealed_toss_identity: &SealedTossIdentity,
    referrer: &str,
    now: i64,
) -> (&'static str, Vec<Value>) {
    let normalized_referrer = normalize_nonempty(referrer, "DEFAULT");
    (
        "INSERT INTO toss_identities (
           id, user_id, toss_user_key_hmac, toss_user_key_sealed,
           referrer, scope_json, status, linked_at, last_seen_at,
           revoked_at, revoke_referrer, created_at, updated_at
         )
         VALUES (
           lower(hex(randomblob(16))), ?1, ?2, ?3,
           ?4, '[]', 'ACTIVE', ?5, ?5,
           NULL, NULL, ?5, ?5
         )
         ON CONFLICT(toss_user_key_hmac) DO UPDATE SET
           user_id = excluded.user_id,
           toss_user_key_sealed = excluded.toss_user_key_sealed,
           referrer = excluded.referrer,
           status = 'ACTIVE',
           linked_at = CASE
             WHEN toss_identities.status = 'REVOKED' THEN excluded.linked_at
             ELSE toss_identities.linked_at
           END,
           last_seen_at = excluded.last_seen_at,
           revoked_at = NULL,
           revoke_referrer = NULL,
           updated_at = excluded.updated_at",
        vec![
            Value::Text(user_id.to_string()),
            Value::Text(sealed_toss_identity.hmac.clone()),
            Value::Text(sealed_toss_identity.sealed.clone()),
            Value::Text(normalized_referrer),
            Value::Integer(now),
        ],
    )
}

fn upsert_toss_identity_for_trailbase_user_statement(
    user: &[u8],
    sealed_toss_identity: &SealedTossIdentity,
    referrer: &str,
    now: i64,
) -> (&'static str, Vec<Value>) {
    let normalized_referrer = normalize_nonempty(referrer, "DEFAULT");
    (
        "INSERT INTO toss_identities (
           id, \"user\", toss_user_key_hmac, toss_user_key_sealed,
           referrer, scope_json, status, linked_at, last_seen_at,
           revoked_at, revoke_referrer, created_at, updated_at
         )
         VALUES (
           lower(hex(randomblob(16))), ?1, ?2, ?3,
           ?4, '[]', 'ACTIVE', ?5, ?5,
           NULL, NULL, ?5, ?5
         )
         ON CONFLICT(toss_user_key_hmac) DO UPDATE SET
           \"user\" = CASE
             WHEN toss_identities.status = 'ACTIVE' THEN toss_identities.\"user\"
             ELSE excluded.\"user\"
           END,
           toss_user_key_sealed = excluded.toss_user_key_sealed,
           referrer = excluded.referrer,
           status = 'ACTIVE',
           linked_at = CASE
             WHEN toss_identities.status = 'REVOKED' THEN excluded.linked_at
             ELSE toss_identities.linked_at
           END,
           last_seen_at = excluded.last_seen_at,
           revoked_at = NULL,
           revoke_referrer = NULL,
           updated_at = excluded.updated_at
         RETURNING id, \"user\"",
        vec![
            Value::Blob(user.to_vec()),
            Value::Text(sealed_toss_identity.hmac.clone()),
            Value::Text(sealed_toss_identity.sealed.clone()),
            Value::Text(normalized_referrer),
            Value::Integer(now),
        ],
    )
}

fn revoke_toss_identity_by_hmac_statement(
    toss_user_key_hmac: &str,
    referrer: &str,
    now: i64,
) -> (&'static str, Vec<Value>) {
    let normalized_referrer = normalize_nonempty(referrer, "UNLINK");
    (
        "UPDATE toss_identities
         SET status = 'REVOKED',
             toss_user_key_sealed = ?1,
             revoked_at = ?2,
             revoke_referrer = ?3,
             updated_at = ?2
         WHERE toss_user_key_hmac = ?4
           AND status = 'ACTIVE'
         RETURNING id, user_id",
        vec![
            Value::Text(TOSS_IDENTITY_REVOKED_SEALED_TOMBSTONE.to_string()),
            Value::Integer(now),
            Value::Text(normalized_referrer),
            Value::Text(toss_user_key_hmac.to_string()),
        ],
    )
}

fn revoke_toss_identity_by_hmac_for_trailbase_user_statement(
    toss_user_key_hmac: &str,
    referrer: &str,
    now: i64,
) -> (&'static str, Vec<Value>) {
    let normalized_referrer = normalize_nonempty(referrer, "UNLINK");
    (
        "UPDATE toss_identities
         SET status = 'REVOKED',
             toss_user_key_sealed = ?1,
             revoked_at = ?2,
             revoke_referrer = ?3,
             updated_at = ?2
         WHERE toss_user_key_hmac = ?4
           AND status = 'ACTIVE'
         RETURNING id, \"user\"",
        vec![
            Value::Text(TOSS_IDENTITY_REVOKED_SEALED_TOMBSTONE.to_string()),
            Value::Integer(now),
            Value::Text(normalized_referrer),
            Value::Text(toss_user_key_hmac.to_string()),
        ],
    )
}

fn touch_toss_identity_seen_statement(user_id: &str, now: i64) -> (&'static str, Vec<Value>) {
    (
        "UPDATE toss_identities
         SET last_seen_at = ?1,
             updated_at = ?1
         WHERE user_id = ?2
           AND status = 'ACTIVE'",
        vec![Value::Integer(now), Value::Text(user_id.to_string())],
    )
}

fn touch_toss_identity_seen_for_trailbase_user_statement(
    user: &[u8],
    now: i64,
) -> (&'static str, Vec<Value>) {
    (
        "UPDATE toss_identities
         SET last_seen_at = ?1,
             updated_at = ?1
         WHERE \"user\" = ?2
           AND status = 'ACTIVE'",
        vec![Value::Integer(now), Value::Blob(user.to_vec())],
    )
}

fn toss_identity_from_row(row: &[Value]) -> ApiResult<TossIdentityRow> {
    Ok(TossIdentityRow {
        id: db::text(&row[0], "toss_identity_id")?,
        user_id: db::text(&row[1], "user_id")?,
        toss_user_key_hmac: db::text(&row[2], "toss_user_key_hmac")?,
        toss_user_key_sealed: db::nullable_text(&row[3])?,
        referrer: db::text(&row[4], "referrer")?,
        linked_at: db::integer(&row[5], "linked_at")?,
        last_seen_at: db::integer(&row[6], "last_seen_at")?,
    })
}

fn auth_toss_identity_from_row(row: &[Value]) -> ApiResult<AuthTossIdentityRow> {
    Ok(AuthTossIdentityRow {
        id: db::text(&row[0], "toss_identity_id")?,
        user: db::blob(&row[1], "trailbase_user")?,
        toss_user_key_hmac: db::text(&row[2], "toss_user_key_hmac")?,
        toss_user_key_sealed: db::nullable_text(&row[3])?,
        referrer: db::text(&row[4], "referrer")?,
        linked_at: db::integer(&row[5], "linked_at")?,
        last_seen_at: db::integer(&row[6], "last_seen_at")?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_empty_values() {
        assert_eq!(normalize_nonempty("", "DEFAULT"), "DEFAULT");
        assert_eq!(normalize_nonempty("  ", "DEFAULT"), "DEFAULT");
        assert_eq!(normalize_nonempty("SANDBOX", "DEFAULT"), "SANDBOX");
    }

    #[test]
    fn exposes_crypto_erase_tombstone() {
        assert_eq!(TOSS_IDENTITY_REVOKED_SEALED_TOMBSTONE, "REVOKED");
    }
}

#[cfg(all(test, not(target_arch = "wasm32")))]
mod sql_tests {
    use super::*;
    use crate::sql_test_support::{
        database_with, execute, query, query_values, template_sql, try_query,
    };
    use rusqlite::Connection;

    fn sealed(hmac: &str, sealed: &str) -> SealedTossIdentity {
        SealedTossIdentity {
            hmac: hmac.into(),
            sealed: sealed.into(),
        }
    }

    fn rows(db: &Connection, (sql, params): (&str, Vec<Value>)) -> Vec<Vec<Value>> {
        query_values(db, sql, &params)
    }

    fn template_database() -> Connection {
        let db = database_with(&["toss_identities.sql"]);
        db.execute_batch("INSERT INTO _user VALUES (X'02')")
            .unwrap();
        db
    }

    // The user_id helpers predate the `_user` foreign key (see schema-patterns.md);
    // derive that shape from the template so the remaining columns stay in sync.
    fn legacy_user_id_database() -> Connection {
        let legacy = template_sql("toss_identities.sql")
            .replace(
                "\"user\" BLOB NOT NULL REFERENCES _user(id) ON DELETE CASCADE",
                "user_id TEXT NOT NULL",
            )
            .replace(
                "toss_identities(\"user\", status)",
                "toss_identities(user_id, status)",
            );
        assert!(
            !legacy.contains("\"user\""),
            "update the legacy user_id fixture for the new toss_identities.sql"
        );
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch(&legacy).unwrap();
        db
    }

    fn stored_revocation(db: &Connection) -> (String, String, i64) {
        db.query_row(
            "SELECT toss_user_key_sealed, revoke_referrer, revoked_at FROM toss_identities",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .unwrap()
    }

    #[test]
    fn trailbase_user_statements_keep_active_identities_canonical() {
        let db = template_database();
        let first = rows(
            &db,
            upsert_toss_identity_for_trailbase_user_statement(
                &[1],
                &sealed("hmac-1", "sealed-1"),
                " SANDBOX ",
                10,
            ),
        );
        let id = db::text(&first[0][0], "id").unwrap();
        assert_eq!(db::blob(&first[0][1], "user").unwrap(), vec![1]);

        let collision = rows(
            &db,
            upsert_toss_identity_for_trailbase_user_statement(
                &[2],
                &sealed("hmac-1", "sealed-2"),
                "",
                20,
            ),
        );
        assert_eq!(db::text(&collision[0][0], "id").unwrap(), id);
        assert_eq!(db::blob(&collision[0][1], "user").unwrap(), vec![1]);
        assert!(rows(&db, active_toss_identity_for_trailbase_user_statement(&[2])).is_empty());

        let (sql, params) = touch_toss_identity_seen_for_trailbase_user_statement(&[1], 30);
        assert_eq!(execute(&db, sql, &params), 1);
        let active = rows(&db, active_toss_identity_for_trailbase_user_statement(&[1]));
        assert_eq!(
            auth_toss_identity_from_row(&active[0]).unwrap(),
            AuthTossIdentityRow {
                id: id.clone(),
                user: vec![1],
                toss_user_key_hmac: "hmac-1".into(),
                toss_user_key_sealed: Some("sealed-2".into()),
                referrer: "DEFAULT".into(),
                linked_at: 10,
                last_seen_at: 30,
            }
        );
        let lookup = rows(
            &db,
            trailbase_user_for_toss_identity_hmac_statement("hmac-1"),
        );
        assert_eq!(db::blob(&lookup[0][0], "user").unwrap(), vec![1]);
    }

    #[test]
    fn trailbase_user_revocation_tombstones_and_relinks_to_the_new_user() {
        let db = template_database();
        let first = rows(
            &db,
            upsert_toss_identity_for_trailbase_user_statement(
                &[1],
                &sealed("hmac-1", "sealed-1"),
                "",
                10,
            ),
        );
        let id = db::text(&first[0][0], "id").unwrap();

        let revoked = rows(
            &db,
            revoke_toss_identity_by_hmac_for_trailbase_user_statement("hmac-1", " ", 40),
        );
        assert_eq!(db::text(&revoked[0][0], "id").unwrap(), id);
        assert_eq!(db::blob(&revoked[0][1], "user").unwrap(), vec![1]);
        assert_eq!(
            stored_revocation(&db),
            (
                TOSS_IDENTITY_REVOKED_SEALED_TOMBSTONE.to_string(),
                "UNLINK".to_string(),
                40
            )
        );
        assert!(
            rows(
                &db,
                revoke_toss_identity_by_hmac_for_trailbase_user_statement("hmac-1", "", 41)
            )
            .is_empty()
        );
        assert!(
            rows(
                &db,
                trailbase_user_for_toss_identity_hmac_statement("hmac-1")
            )
            .is_empty()
        );
        assert!(rows(&db, active_toss_identity_for_trailbase_user_statement(&[1])).is_empty());

        let relinked = rows(
            &db,
            upsert_toss_identity_for_trailbase_user_statement(
                &[2],
                &sealed("hmac-1", "sealed-3"),
                "TOSS",
                50,
            ),
        );
        assert_eq!(db::text(&relinked[0][0], "id").unwrap(), id);
        assert_eq!(db::blob(&relinked[0][1], "user").unwrap(), vec![2]);
        let active = rows(&db, active_toss_identity_for_trailbase_user_statement(&[2]));
        let identity = auth_toss_identity_from_row(&active[0]).unwrap();
        assert_eq!(
            (identity.linked_at, identity.last_seen_at),
            (50, 50),
            "relinking a revoked identity starts a new link"
        );
        assert_eq!(identity.toss_user_key_sealed.as_deref(), Some("sealed-3"));
        assert_eq!(
            query(
                &db,
                "SELECT revoked_at, revoke_referrer FROM toss_identities",
                &[]
            ),
            vec![vec![
                rusqlite::types::Value::Null,
                rusqlite::types::Value::Null
            ]]
        );
    }

    #[test]
    fn template_requires_a_sealed_key_for_active_identities() {
        let db = template_database();
        let (sql, params) =
            upsert_toss_identity_for_trailbase_user_statement(&[1], &sealed("hmac-1", " "), "", 10);
        let error = try_query(&db, sql, &params).unwrap_err().to_string();
        assert!(error.contains("CHECK constraint failed"), "{error}");
    }

    #[test]
    fn legacy_user_id_statements_do_not_match_the_template() {
        let db = template_database();
        for (sql, _) in [
            active_toss_identity_statement("user-1"),
            upsert_toss_identity_statement("user-1", &sealed("hmac-1", "sealed-1"), "", 10),
            revoke_toss_identity_by_hmac_statement("hmac-1", "", 10),
            touch_toss_identity_seen_statement("user-1", 10),
        ] {
            let error = db.prepare(sql).unwrap_err().to_string();
            assert!(error.contains("user_id"), "{error}");
        }
    }

    #[test]
    fn legacy_user_id_statements_run_against_the_pre_user_shape() {
        let db = legacy_user_id_database();
        let (sql, params) =
            upsert_toss_identity_statement("user-1", &sealed("hmac-1", "sealed-1"), "", 10);
        assert_eq!(execute(&db, sql, &params), 1);
        let (sql, params) =
            upsert_toss_identity_statement("user-2", &sealed("hmac-1", "sealed-2"), "SANDBOX", 20);
        assert_eq!(execute(&db, sql, &params), 1);
        assert!(rows(&db, active_toss_identity_statement("user-1")).is_empty());

        let (sql, params) = touch_toss_identity_seen_statement("user-2", 30);
        assert_eq!(execute(&db, sql, &params), 1);
        let active = rows(&db, active_toss_identity_statement("user-2"));
        let identity = toss_identity_from_row(&active[0]).unwrap();
        assert_eq!(
            (
                identity.user_id.as_str(),
                identity.toss_user_key_sealed.as_deref(),
                identity.referrer.as_str(),
                identity.linked_at,
                identity.last_seen_at,
            ),
            ("user-2", Some("sealed-2"), "SANDBOX", 10, 30)
        );

        let revoked = rows(
            &db,
            revoke_toss_identity_by_hmac_statement("hmac-1", "", 40),
        );
        assert_eq!(db::text(&revoked[0][0], "id").unwrap(), identity.id);
        assert_eq!(db::text(&revoked[0][1], "user_id").unwrap(), "user-2");
        assert_eq!(
            stored_revocation(&db).0,
            TOSS_IDENTITY_REVOKED_SEALED_TOMBSTONE
        );
        assert!(rows(&db, active_toss_identity_statement("user-2")).is_empty());
    }
}
