use std::time::{SystemTime, UNIX_EPOCH};

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use hmac::{Hmac, KeyInit, Mac};
use serde::{Deserialize, Serialize};
use sha2::Sha256;

use crate::responses::{ApiResult, bad_request, internal, unauthorized};
use crate::{hmac_sha256_hex, settings};

type HmacSha256 = Hmac<Sha256>;

#[derive(Debug, Serialize, Deserialize)]
struct SessionPayload {
    user_id: String,
    exp: i64,
    iat: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnonymousTrailbaseUserCredentials {
    pub email: String,
    pub password: String,
}

pub fn hmac_hex(secret: &str, input: &str) -> ApiResult<String> {
    hmac_sha256_hex(secret, input).map_err(internal)
}

pub fn issue_session(user_id: &str) -> ApiResult<String> {
    let secret = session_secret()?;
    let now = unix_ms()?;
    let payload = SessionPayload {
        user_id: user_id.to_string(),
        iat: now,
        exp: now + session_ttl_ms(),
    };
    let payload_json = serde_json::to_vec(&payload)
        .map_err(|err| internal(format!("Failed to serialize session payload: {err}")))?;
    let encoded_payload = URL_SAFE_NO_PAD.encode(payload_json);
    let signature = sign(&secret, encoded_payload.as_bytes())?;
    Ok(format!("v1.{encoded_payload}.{signature}"))
}

pub fn verify_session(token: &str) -> ApiResult<String> {
    let secret = session_secret()?;
    let mut parts = token.split('.');
    let version = parts.next().unwrap_or_default();
    let payload = parts.next().unwrap_or_default();
    let signature = parts.next().unwrap_or_default();
    if version != "v1" || payload.is_empty() || signature.is_empty() || parts.next().is_some() {
        return Err(unauthorized("INVALID_SESSION", "Invalid session token"));
    }

    let expected = sign(&secret, payload.as_bytes())?;
    if !constant_time_eq(expected.as_bytes(), signature.as_bytes()) {
        return Err(unauthorized("INVALID_SESSION", "Invalid session token"));
    }

    let payload_bytes = URL_SAFE_NO_PAD
        .decode(payload)
        .map_err(|_| unauthorized("INVALID_SESSION", "Invalid session token"))?;
    let payload: SessionPayload = serde_json::from_slice(&payload_bytes)
        .map_err(|_| unauthorized("INVALID_SESSION", "Invalid session token"))?;
    if payload.exp < unix_ms()? {
        return Err(unauthorized("SESSION_EXPIRED", "Session token expired"));
    }
    Ok(payload.user_id)
}

pub fn anonymous_hash_hmac(anonymous_hash: &str) -> ApiResult<String> {
    if anonymous_hash.len() < 8 || anonymous_hash.len() > 512 {
        return Err(bad_request(
            "INVALID_ANONYMOUS_HASH",
            "Invalid anonymousHash",
        ));
    }
    let secret = settings::required("USER_HASH_HMAC_SECRET")?;
    hmac_hex(&secret, anonymous_hash)
}

pub fn anonymous_trailbase_user_credentials(
    anonymous_hash_hmac: &str,
    password_secret: &str,
) -> ApiResult<AnonymousTrailbaseUserCredentials> {
    Ok(AnonymousTrailbaseUserCredentials {
        email: anonymous_trailbase_user_email(anonymous_hash_hmac)?,
        password: service_managed_user_password(anonymous_hash_hmac, password_secret)?,
    })
}

pub fn anonymous_trailbase_user_email(anonymous_hash_hmac: &str) -> ApiResult<String> {
    anonymous_trailbase_user_email_with_domain(anonymous_hash_hmac, "users.local.invalid")
}

pub fn anonymous_trailbase_user_email_with_domain(
    anonymous_hash_hmac: &str,
    domain: &str,
) -> ApiResult<String> {
    let digest = normalized_hex_digest(anonymous_hash_hmac)?;
    let domain = domain.trim().trim_start_matches('@').to_ascii_lowercase();
    if domain.is_empty() || !domain.contains('.') || domain.contains(' ') {
        return Err(bad_request(
            "INVALID_EMAIL_DOMAIN",
            "Invalid anonymous user email domain",
        ));
    }
    Ok(format!("anon+{}@{}", &digest[..32], domain))
}

pub fn service_managed_user_password(
    anonymous_hash_hmac: &str,
    password_secret: &str,
) -> ApiResult<String> {
    let digest = normalized_hex_digest(anonymous_hash_hmac)?;
    let secret = password_secret.trim();
    if secret.len() < 16 {
        return Err(internal(
            "Service-managed user password secret must be at least 16 bytes",
        ));
    }
    let password_digest = hmac_hex(secret, &digest)?;
    Ok(format!("Ait!1{password_digest}"))
}

fn session_secret() -> ApiResult<String> {
    settings::required("APP_SESSION_SECRET")
}

fn session_ttl_ms() -> i64 {
    settings::i64_or("APP_SESSION_TTL_SECONDS", 86_400) * 1000
}

fn sign(secret: &str, data: &[u8]) -> ApiResult<String> {
    let mut mac = HmacSha256::new_from_slice(secret.as_bytes())
        .map_err(|err| internal(format!("Invalid session secret: {err}")))?;
    mac.update(data);
    Ok(URL_SAFE_NO_PAD.encode(mac.finalize().into_bytes()))
}

fn unix_ms() -> ApiResult<i64> {
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|err| internal(format!("System clock error: {err}")))?;
    Ok(duration.as_millis() as i64)
}

pub fn constant_time_eq(left: &[u8], right: &[u8]) -> bool {
    if left.len() != right.len() {
        return false;
    }
    let mut diff = 0u8;
    for (a, b) in left.iter().zip(right.iter()) {
        diff |= a ^ b;
    }
    diff == 0
}

fn normalized_hex_digest(value: &str) -> ApiResult<String> {
    let digest = value.trim().to_ascii_lowercase();
    if digest.len() < 32 || digest.len() > 128 || !digest.chars().all(|ch| ch.is_ascii_hexdigit()) {
        return Err(bad_request(
            "INVALID_HASH_DIGEST",
            "Invalid anonymous hash digest",
        ));
    }
    Ok(digest)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn constant_time_eq_checks_lengths_and_bytes() {
        assert!(constant_time_eq(b"abc", b"abc"));
        assert!(!constant_time_eq(b"abc", b"abd"));
        assert!(!constant_time_eq(b"abc", b"abcd"));
    }

    #[test]
    fn derives_anonymous_trailbase_user_credentials() {
        let digest = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
        let credentials =
            anonymous_trailbase_user_credentials(digest, "service-password-secret").unwrap();

        assert_eq!(
            credentials.email,
            "anon+0123456789abcdef0123456789abcdef@users.local.invalid"
        );
        assert!(credentials.password.starts_with("Ait!1"));
        assert_eq!(credentials.password.len(), 69);
    }

    #[test]
    fn rejects_invalid_anonymous_user_inputs() {
        assert!(anonymous_trailbase_user_email("not-hex").is_err());
        assert!(
            anonymous_trailbase_user_email_with_domain(
                "0123456789abcdef0123456789abcdef",
                "bad domain"
            )
            .is_err()
        );
        assert!(
            service_managed_user_password("0123456789abcdef0123456789abcdef", "short").is_err()
        );
    }
}
