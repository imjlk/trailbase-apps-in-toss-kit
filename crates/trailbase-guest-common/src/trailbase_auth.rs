use trailbase_wasm::db::{Transaction, Value};

use crate::db;
use crate::responses::{ApiResult, internal};
use crate::session::{
    AnonymousTrailbaseUserCredentials, anonymous_trailbase_user_credentials,
    anonymous_trailbase_user_email, service_managed_user_password,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TrailBaseAuthUser {
    pub id: Vec<u8>,
    pub email: String,
}

pub fn anonymous_auth_user_credentials(
    anonymous_hash_hmac: &str,
    password_secret: &str,
) -> ApiResult<AnonymousTrailbaseUserCredentials> {
    anonymous_trailbase_user_credentials(anonymous_hash_hmac, password_secret)
}

pub fn anonymous_auth_user_email(anonymous_hash_hmac: &str) -> ApiResult<String> {
    anonymous_trailbase_user_email(anonymous_hash_hmac)
}

pub fn anonymous_auth_user_password(
    anonymous_hash_hmac: &str,
    password_secret: &str,
) -> ApiResult<String> {
    service_managed_user_password(anonymous_hash_hmac, password_secret)
}

pub fn upsert_verified_auth_user_tx(
    tx: &mut Transaction,
    credentials: &AnonymousTrailbaseUserCredentials,
) -> ApiResult<TrailBaseAuthUser> {
    let rows = db::tx_query(
        tx,
        "INSERT INTO _user (email, password_hash, verified)
         VALUES (?1, hash_password(?2), 1)
         ON CONFLICT(email) DO UPDATE SET
           password_hash = excluded.password_hash,
           verified = 1
         RETURNING id, email",
        &[
            Value::Text(credentials.email.clone()),
            Value::Text(credentials.password.clone()),
        ],
    )?;
    let row = rows
        .first()
        .ok_or_else(|| internal("Failed to upsert TrailBase auth user"))?;
    Ok(TrailBaseAuthUser {
        id: db::blob(&row[0], "trailbase_user_id")?,
        email: db::text(&row[1], "trailbase_user_email")?,
    })
}
