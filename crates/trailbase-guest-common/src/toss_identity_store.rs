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

pub fn active_toss_identity_tx(
    tx: &mut Transaction,
    user_id: &str,
) -> ApiResult<Option<TossIdentityRow>> {
    let rows = db::tx_query(
        tx,
        "SELECT id, user_id, toss_user_key_hmac, toss_user_key_sealed,
                referrer, linked_at, last_seen_at
         FROM toss_identities
         WHERE user_id = ?1
           AND status = 'ACTIVE'
         ORDER BY last_seen_at DESC, linked_at DESC
         LIMIT 1",
        &[Value::Text(user_id.to_string())],
    )?;
    rows.first()
        .map(|row| toss_identity_from_row(row))
        .transpose()
}

pub fn active_toss_identity_for_trailbase_user_tx(
    tx: &mut Transaction,
    user: &[u8],
) -> ApiResult<Option<AuthTossIdentityRow>> {
    let rows = db::tx_query(
        tx,
        "SELECT id, \"user\", toss_user_key_hmac, toss_user_key_sealed,
                referrer, linked_at, last_seen_at
         FROM toss_identities
         WHERE \"user\" = ?1
           AND status = 'ACTIVE'
         ORDER BY last_seen_at DESC, linked_at DESC
         LIMIT 1",
        &[Value::Blob(user.to_vec())],
    )?;
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
    let rows = db::tx_query(
        tx,
        "SELECT \"user\"
         FROM toss_identities
         WHERE toss_user_key_hmac = ?1
           AND status = 'ACTIVE'
         ORDER BY last_seen_at DESC, linked_at DESC
         LIMIT 1",
        &[Value::Text(toss_user_key_hmac.to_string())],
    )?;
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
    let normalized_referrer = normalize_nonempty(referrer, "DEFAULT");
    db::tx_execute(
        tx,
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
        &[
            Value::Text(user_id.to_string()),
            Value::Text(sealed_toss_identity.hmac.clone()),
            Value::Text(sealed_toss_identity.sealed.clone()),
            Value::Text(normalized_referrer),
            Value::Integer(now),
        ],
    )?;
    Ok(())
}

pub fn upsert_toss_identity_for_trailbase_user_tx(
    tx: &mut Transaction,
    user: &[u8],
    sealed_toss_identity: &SealedTossIdentity,
    referrer: &str,
    now: i64,
) -> ApiResult<()> {
    let normalized_referrer = normalize_nonempty(referrer, "DEFAULT");
    db::tx_execute(
        tx,
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
           \"user\" = excluded.\"user\",
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
        &[
            Value::Blob(user.to_vec()),
            Value::Text(sealed_toss_identity.hmac.clone()),
            Value::Text(sealed_toss_identity.sealed.clone()),
            Value::Text(normalized_referrer),
            Value::Integer(now),
        ],
    )?;
    Ok(())
}

pub fn revoke_toss_identity_by_hmac_tx(
    tx: &mut Transaction,
    toss_user_key_hmac: &str,
    referrer: &str,
    now: i64,
) -> ApiResult<Option<TossIdentityRevokeResult>> {
    let normalized_referrer = normalize_nonempty(referrer, "UNLINK");
    let rows = db::tx_query(
        tx,
        "UPDATE toss_identities
         SET status = 'REVOKED',
             toss_user_key_sealed = ?1,
             revoked_at = ?2,
             revoke_referrer = ?3,
             updated_at = ?2
         WHERE toss_user_key_hmac = ?4
           AND status = 'ACTIVE'
         RETURNING id, user_id",
        &[
            Value::Text(TOSS_IDENTITY_REVOKED_SEALED_TOMBSTONE.to_string()),
            Value::Integer(now),
            Value::Text(normalized_referrer),
            Value::Text(toss_user_key_hmac.to_string()),
        ],
    )?;
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
    let normalized_referrer = normalize_nonempty(referrer, "UNLINK");
    let rows = db::tx_query(
        tx,
        "UPDATE toss_identities
         SET status = 'REVOKED',
             toss_user_key_sealed = ?1,
             revoked_at = ?2,
             revoke_referrer = ?3,
             updated_at = ?2
         WHERE toss_user_key_hmac = ?4
           AND status = 'ACTIVE'
         RETURNING id, \"user\"",
        &[
            Value::Text(TOSS_IDENTITY_REVOKED_SEALED_TOMBSTONE.to_string()),
            Value::Integer(now),
            Value::Text(normalized_referrer),
            Value::Text(toss_user_key_hmac.to_string()),
        ],
    )?;
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
    db::tx_execute(
        tx,
        "UPDATE toss_identities
         SET last_seen_at = ?1,
             updated_at = ?1
         WHERE user_id = ?2
           AND status = 'ACTIVE'",
        &[Value::Integer(now), Value::Text(user_id.to_string())],
    )?;
    Ok(())
}

pub fn touch_toss_identity_seen_for_trailbase_user_tx(
    tx: &mut Transaction,
    user: &[u8],
    now: i64,
) -> ApiResult<()> {
    db::tx_execute(
        tx,
        "UPDATE toss_identities
         SET last_seen_at = ?1,
             updated_at = ?1
         WHERE \"user\" = ?2
           AND status = 'ACTIVE'",
        &[Value::Integer(now), Value::Blob(user.to_vec())],
    )?;
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
