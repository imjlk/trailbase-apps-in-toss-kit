//! Verification and private storage for Apps in Toss anonymous identities.
use crate::responses::{ApiResult, bad_request, internal};
use crate::{CommonResult, db, hmac_sha256_hex, join_url, post_json_with_optional_bearer};
use serde_json::{Value as JsonValue, json};
use trailbase_wasm::db::{Transaction, Value};

pub const ANONYMOUS_KEY_VERIFY_PATH: &str = "/internal/apps-in-toss/anonymous-key/verify";

// Intentionally no Debug or Serialize: this is a backend-only raw identity.
pub struct VerifiedAnonymousKey {
    anonymous_hash: String,
}
impl VerifiedAnonymousKey {
    pub fn anonymous_hash(&self) -> &str {
        &self.anonymous_hash
    }
    pub fn raw_key(&self) -> &str {
        &self.anonymous_hash[4..]
    }
    pub fn hmac(&self, secret: &str) -> CommonResult<String> {
        hmac_sha256_hex(secret, &self.anonymous_hash)
    }
}

pub async fn verify_anonymous_hash(
    proxy_url: &str,
    bearer_token: Option<&str>,
    anonymous_hash: &str,
) -> CommonResult<VerifiedAnonymousKey> {
    let hash = normalize_anonymous_hash(anonymous_hash)?;
    let result = post_json_with_optional_bearer(
        &join_url(proxy_url, ANONYMOUS_KEY_VERIFY_PATH),
        json!({"anonKey": &hash[4..]}),
        bearer_token,
    )
    .await?;
    if !anonymous_verification_succeeded(&result) {
        return Err("Apps in Toss anonymous key verification failed".into());
    }
    Ok(VerifiedAnonymousKey {
        anonymous_hash: hash,
    })
}

pub fn anonymous_verification_succeeded(result: &JsonValue) -> bool {
    result.get("ok").and_then(JsonValue::as_bool) == Some(true)
        && result.get("valid").and_then(JsonValue::as_bool) == Some(true)
        && result.get("resultType").and_then(JsonValue::as_str) == Some("SUCCESS")
}

pub fn normalize_anonymous_hash(value: &str) -> CommonResult<String> {
    let hash = value.trim();
    let raw = hash
        .strip_prefix("ait:")
        .ok_or("Production anonymous hash must start with ait:")?;
    if raw.is_empty() || raw.trim() != raw || raw.len() > 4096 || raw.chars().any(char::is_control)
    {
        return Err("Invalid anonymous hash".into());
    }
    Ok(hash.to_owned())
}

pub(crate) const UPSERT_IDENTITY: &str = "INSERT INTO anonymous_identities
    (anonymous_hash_hmac,user_id,anonymous_key_sealed,verified_at,updated_at)
    VALUES (?1,?2,?3,?4,?4)
    ON CONFLICT(anonymous_hash_hmac) DO UPDATE SET
      anonymous_key_sealed=excluded.anonymous_key_sealed,
      verified_at=excluded.verified_at, updated_at=excluded.updated_at
    WHERE anonymous_identities.user_id=excluded.user_id AND anonymous_identities.revoked_at IS NULL";

/// Resolve existing anonymous_user_links and reject disabled principals before
/// calling this. A verified key must never reassign an identity to another user.
pub fn store_verified_anonymous_identity_tx(
    tx: &mut Transaction,
    verified: &VerifiedAnonymousKey,
    user: &[u8],
    hmac_secret: &str,
    anonymous_key_sealed: &str,
    now: i64,
) -> ApiResult<String> {
    if user.is_empty() || anonymous_key_sealed.trim().is_empty() {
        return Err(bad_request(
            "INVALID_ANONYMOUS_IDENTITY",
            "user and sealed key are required",
        ));
    }
    let hmac = verified
        .hmac(hmac_secret)
        .map_err(|_| internal("Failed to hash anonymous identity"))?;
    let changed = db::tx_execute(
        tx,
        UPSERT_IDENTITY,
        &[
            Value::Text(hmac.clone()),
            Value::Blob(user.to_vec()),
            Value::Text(anonymous_key_sealed.to_owned()),
            Value::Integer(now),
        ],
    )?;
    if changed != 1 {
        return Err(bad_request(
            "ANONYMOUS_IDENTITY_CONFLICT",
            "identity is revoked or linked to a different principal",
        ));
    }
    Ok(hmac)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn verification_requires_explicit_success_and_true_boolean() {
        for result in [
            json!({}),
            json!({"ok":true,"valid":false,"resultType":"SUCCESS"}),
            json!({"ok":false,"valid":true,"resultType":"SUCCESS"}),
            json!({"ok":true,"valid":"true","resultType":"SUCCESS"}),
            json!({"ok":true,"valid":true,"resultType":"FAIL"}),
        ] {
            assert!(!anonymous_verification_succeeded(&result));
        }
        assert!(anonymous_verification_succeeded(
            &json!({"ok":true,"valid":true,"resultType":"SUCCESS"})
        ));
    }
    #[test]
    fn preserves_existing_prefixed_hmac_seed_and_rejects_dev_identity() {
        assert_eq!(normalize_anonymous_hash("ait:abc").unwrap(), "ait:abc");
        for hash in ["dev-abc", "ait:", "ait: abc", "ait:a\nb"] {
            assert!(normalize_anonymous_hash(hash).is_err());
        }
        let key = VerifiedAnonymousKey {
            anonymous_hash: "ait:abc".into(),
        };
        assert_eq!(
            key.hmac("secret").unwrap(),
            hmac_sha256_hex("secret", "ait:abc").unwrap()
        );
    }
}
