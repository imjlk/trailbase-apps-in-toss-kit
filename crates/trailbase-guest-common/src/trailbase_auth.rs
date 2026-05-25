use serde::{Deserialize, Serialize};
use serde_json::{Value as JsonValue, json};
use trailbase_wasm::db::{Transaction, Value};

use crate::db;
use crate::responses::{ApiError, ApiResult, bad_request, internal, too_many_requests};
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

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnonymousUserLink {
    pub anonymous_hash_hmac: String,
    pub canonical_user: Vec<u8>,
    pub canonical_anonymous_hash_hmac: String,
    pub previous_user: Option<Vec<u8>>,
    pub link_reason: String,
    pub linked_at: i64,
    pub updated_at: i64,
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

pub fn rehash_auth_user_password_tx(
    tx: &mut Transaction,
    credentials: &AnonymousTrailbaseUserCredentials,
) -> ApiResult<()> {
    let changed = db::tx_execute(
        tx,
        "UPDATE _user
         SET password_hash = hash_password(?2),
             verified = 1
         WHERE email = ?1",
        &[
            Value::Text(credentials.email.clone()),
            Value::Text(credentials.password.clone()),
        ],
    )?;
    if changed == 0 {
        return Err(internal(
            "TrailBase auth user was not found for password rehash",
        ));
    }
    Ok(())
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

pub async fn login_anonymous_auth_user_with_password_rotation(
    api_base_url: &str,
    anonymous_hash_hmac: &str,
    current_password_secret: &str,
    previous_password_secret: Option<&str>,
) -> ApiResult<TrailBaseAuthTokens> {
    let current_credentials =
        anonymous_auth_user_credentials(anonymous_hash_hmac, current_password_secret)?;
    match login_auth_user(api_base_url, &current_credentials).await {
        Ok(tokens) => Ok(tokens),
        Err(current_error) => {
            let previous_secret = previous_password_secret
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .filter(|value| *value != current_password_secret.trim());
            let Some(previous_secret) = previous_secret else {
                return Err(current_error);
            };
            let previous_credentials =
                anonymous_auth_user_credentials(anonymous_hash_hmac, previous_secret)?;
            let tokens = login_auth_user(api_base_url, &previous_credentials)
                .await
                .map_err(|previous_error| {
                    prefer_current_login_error(current_error, previous_error)
                })?;
            let mut tx = db::tx()?;
            rehash_auth_user_password_tx(&mut tx, &current_credentials)?;
            db::tx_commit(&mut tx)?;
            Ok(tokens)
        }
    }
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

pub fn anonymous_user_link_tx(
    tx: &mut Transaction,
    anonymous_hash_hmac: &str,
) -> ApiResult<Option<AnonymousUserLink>> {
    let rows = db::tx_query(
        tx,
        "SELECT anonymous_hash_hmac, canonical_user, canonical_anonymous_hash_hmac,
                previous_user, link_reason, linked_at, updated_at
         FROM anonymous_user_links
         WHERE anonymous_hash_hmac = ?1
         LIMIT 1",
        &[Value::Text(anonymous_hash_hmac.to_string())],
    )?;
    rows.first()
        .map(|row| {
            Ok(AnonymousUserLink {
                anonymous_hash_hmac: db::text(&row[0], "anonymous_hash_hmac")?,
                canonical_user: db::blob(&row[1], "canonical_user")?,
                canonical_anonymous_hash_hmac: db::text(&row[2], "canonical_anonymous_hash_hmac")?,
                previous_user: nullable_blob(&row[3])?,
                link_reason: db::text(&row[4], "link_reason")?,
                linked_at: db::integer(&row[5], "linked_at")?,
                updated_at: db::integer(&row[6], "updated_at")?,
            })
        })
        .transpose()
}

pub fn upsert_anonymous_user_link_tx(
    tx: &mut Transaction,
    anonymous_hash_hmac: &str,
    canonical_user: &[u8],
    canonical_anonymous_hash_hmac: &str,
    previous_user: Option<&[u8]>,
    link_reason: &str,
    now: i64,
) -> ApiResult<()> {
    let reason = normalize_link_reason(link_reason)?;
    db::tx_execute(
        tx,
        "INSERT INTO anonymous_user_links (
           anonymous_hash_hmac, canonical_user, canonical_anonymous_hash_hmac,
           previous_user, link_reason, linked_at, updated_at
         )
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
         ON CONFLICT(anonymous_hash_hmac) DO UPDATE SET
           canonical_user = excluded.canonical_user,
           canonical_anonymous_hash_hmac = excluded.canonical_anonymous_hash_hmac,
           previous_user = excluded.previous_user,
           link_reason = excluded.link_reason,
           updated_at = excluded.updated_at",
        &[
            Value::Text(anonymous_hash_hmac.to_string()),
            Value::Blob(canonical_user.to_vec()),
            Value::Text(canonical_anonymous_hash_hmac.to_string()),
            previous_user
                .map(|value| Value::Blob(value.to_vec()))
                .unwrap_or(Value::Null),
            Value::Text(reason.to_string()),
            Value::Integer(now),
        ],
    )?;
    Ok(())
}

pub fn enforce_anonymous_bootstrap_attempt_limit_tx(
    tx: &mut Transaction,
    bucket_key: &str,
    now: i64,
    max_attempts: i64,
    window_ms: i64,
) -> ApiResult<()> {
    if max_attempts <= 0 || window_ms <= 0 {
        return Ok(());
    }
    let bucket_key = normalize_bootstrap_bucket_key(bucket_key)?;
    let rows = db::tx_query(
        tx,
        "INSERT INTO anonymous_bootstrap_attempts (
           bucket_key, attempt_count, window_started_at, last_attempt_at
         )
         VALUES (?1, 1, ?2, ?2)
         ON CONFLICT(bucket_key) DO UPDATE SET
           attempt_count = CASE
             WHEN anonymous_bootstrap_attempts.window_started_at <= ?2 - ?3 THEN 1
             ELSE anonymous_bootstrap_attempts.attempt_count + 1
           END,
           window_started_at = CASE
             WHEN anonymous_bootstrap_attempts.window_started_at <= ?2 - ?3 THEN ?2
             ELSE anonymous_bootstrap_attempts.window_started_at
           END,
           last_attempt_at = ?2
         RETURNING attempt_count",
        &[
            Value::Text(bucket_key),
            Value::Integer(now),
            Value::Integer(window_ms),
        ],
    )?;
    let attempt_count = db::integer(&rows[0][0], "attempt_count")?;
    if attempt_count > max_attempts {
        return Err(too_many_requests(
            "TOO_MANY_BOOTSTRAPS",
            "Too many anonymous bootstrap attempts. Please retry later.",
        ));
    }
    Ok(())
}

pub fn anonymous_bootstrap_bucket_key(
    anonymous_hash_hmac: &str,
    client_bucket_hint: Option<&str>,
) -> ApiResult<String> {
    let anonymous_digest = anonymous_auth_user_email(anonymous_hash_hmac)?
        .trim_start_matches("anon+")
        .split('@')
        .next()
        .unwrap_or_default()
        .to_string();
    let client_part = client_bucket_hint
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(sanitize_bucket_part)
        .unwrap_or_else(|| "unknown-client".to_string());
    normalize_bootstrap_bucket_key(format!("anon:{anonymous_digest}:client:{client_part}").as_str())
}

fn prefer_current_login_error(current_error: ApiError, previous_error: ApiError) -> ApiError {
    if current_error.status.is_server_error() {
        current_error
    } else {
        previous_error
    }
}

fn nullable_blob(value: &Value) -> ApiResult<Option<Vec<u8>>> {
    match value {
        Value::Blob(v) => Ok(Some(v.clone())),
        Value::Null => Ok(None),
        _ => Err(internal("Unexpected nullable blob type")),
    }
}

fn normalize_link_reason(value: &str) -> ApiResult<&'static str> {
    match value.trim() {
        "toss_identity_collision" => Ok("toss_identity_collision"),
        "manual_merge" => Ok("manual_merge"),
        "migration" => Ok("migration"),
        _ => Err(bad_request(
            "INVALID_LINK_REASON",
            "Invalid anonymous user link reason",
        )),
    }
}

fn normalize_bootstrap_bucket_key(value: &str) -> ApiResult<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed.len() > 256 {
        return Err(bad_request(
            "INVALID_BOOTSTRAP_BUCKET",
            "Invalid anonymous bootstrap bucket",
        ));
    }
    Ok(trimmed.to_string())
}

fn sanitize_bucket_part(value: &str) -> String {
    let sanitized: String = value
        .chars()
        .take(96)
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.' | ':') {
                ch
            } else {
                '_'
            }
        })
        .collect();
    if sanitized.is_empty() {
        "unknown-client".to_string()
    } else {
        sanitized
    }
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

    #[test]
    fn derives_stable_anonymous_bootstrap_bucket_key() {
        let digest = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
        assert_eq!(
            anonymous_bootstrap_bucket_key(digest, Some("  ip:127.0.0.1 ua/test  ")).unwrap(),
            "anon:0123456789abcdef0123456789abcdef:client:ip:127.0.0.1_ua_test"
        );
    }

    #[test]
    fn rejects_invalid_link_reasons_and_bucket_keys() {
        assert!(normalize_link_reason("nope").is_err());
        assert!(normalize_bootstrap_bucket_key("").is_err());
        assert!(normalize_bootstrap_bucket_key(&"x".repeat(257)).is_err());
    }
}
