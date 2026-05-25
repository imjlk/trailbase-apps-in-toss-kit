use serde::{Deserialize, Serialize};
use serde_json::{Value as JsonValue, json};
use trailbase_wasm::db::{Transaction, Value};

use crate::db;
use crate::responses::{ApiResult, internal};
use crate::session::{
    AnonymousTrailbaseUserCredentials, anonymous_trailbase_user_credentials,
    anonymous_trailbase_user_email, service_managed_user_password,
};
use crate::{join_url, post_json_with_optional_bearer, read_string_path};

pub const TRAILBASE_AUTH_LOGIN_PATH: &str = "/api/auth/v1/login";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TrailBaseAuthUser {
    pub id: Vec<u8>,
    pub email: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TrailBaseAuthTokens {
    pub auth_token: String,
    pub refresh_token: Option<String>,
    pub csrf_token: Option<String>,
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

pub async fn login_auth_user(
    api_base_url: &str,
    credentials: &AnonymousTrailbaseUserCredentials,
) -> ApiResult<TrailBaseAuthTokens> {
    let response = post_json_with_optional_bearer(
        &join_url(api_base_url, TRAILBASE_AUTH_LOGIN_PATH),
        json!({
          "email": credentials.email,
          "password": credentials.password,
        }),
        None,
    )
    .await
    .map_err(|err| internal(format!("TrailBase auth login failed: {err}")))?;
    trailbase_auth_tokens_from_response(&response)
}

pub fn trailbase_auth_tokens_from_response(response: &JsonValue) -> ApiResult<TrailBaseAuthTokens> {
    let auth_token = read_string_path(response, &["auth_token", "authToken"])
        .ok_or_else(|| internal("TrailBase auth response missing auth_token"))?;
    Ok(TrailBaseAuthTokens {
        auth_token,
        refresh_token: read_string_path(response, &["refresh_token", "refreshToken"]),
        csrf_token: read_string_path(response, &["csrf_token", "csrfToken"]),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn reads_trailbase_auth_tokens_from_response() {
        assert_eq!(
            trailbase_auth_tokens_from_response(&json!({
                "auth_token": "auth",
                "refresh_token": "refresh",
                "csrf_token": "csrf"
            }))
            .unwrap(),
            TrailBaseAuthTokens {
                auth_token: "auth".to_string(),
                refresh_token: Some("refresh".to_string()),
                csrf_token: Some("csrf".to_string()),
            }
        );
        assert_eq!(
            trailbase_auth_tokens_from_response(&json!({
                "authToken": "camel-auth"
            }))
            .unwrap()
            .auth_token,
            "camel-auth"
        );
        assert!(trailbase_auth_tokens_from_response(&json!({ "ok": true })).is_err());
    }

    #[test]
    fn exposes_current_trailbase_auth_login_path() {
        assert_eq!(TRAILBASE_AUTH_LOGIN_PATH, "/api/auth/v1/login");
    }
}
