use base64::Engine;
use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use hmac::{Hmac, Mac};
use serde_json::Value as JsonValue;
use sha2::Sha256;
use trailbase_wasm::fetch;
use trailbase_wasm::http::IntoBody;

pub type CommonResult<T> = Result<T, String>;

pub fn hmac_sha256_hex(secret: &str, value: &str) -> CommonResult<String> {
    let mut mac = Hmac::<Sha256>::new_from_slice(secret.as_bytes())
        .map_err(|err| format!("invalid HMAC secret: {err}"))?;
    mac.update(value.as_bytes());
    Ok(hex::encode(mac.finalize().into_bytes()))
}

pub fn decode_32_byte_secret(value: &str) -> CommonResult<[u8; 32]> {
    let trimmed = value.trim();
    let decoded = if trimmed.len() == 64 && trimmed.chars().all(|ch| ch.is_ascii_hexdigit()) {
        hex::decode(trimmed).map_err(|err| format!("invalid hex secret: {err}"))?
    } else {
        URL_SAFE_NO_PAD
            .decode(trimmed)
            .or_else(|_| STANDARD.decode(trimmed))
            .map_err(|err| format!("invalid base64 secret: {err}"))?
    };
    decoded
        .try_into()
        .map_err(|_| "secret must decode to exactly 32 bytes".to_string())
}

pub fn join_url(base_url: &str, path: &str) -> String {
    format!(
        "{}/{}",
        base_url.trim_end_matches('/'),
        path.trim_start_matches('/')
    )
}

pub async fn post_json_with_optional_bearer(
    url: &str,
    payload: JsonValue,
    bearer_token: Option<&str>,
) -> CommonResult<JsonValue> {
    let mut builder = fetch::Request::builder()
        .method("POST")
        .uri(url)
        .header("Content-Type", "application/json");
    if let Some(token) = bearer_token.filter(|value| !value.trim().is_empty()) {
        builder = builder.header("Authorization", format!("Bearer {token}"));
    }
    let request = builder
        .body(payload.to_string().into_body())
        .map_err(|err| format!("failed to build proxy request: {err}"))?;
    let bytes = fetch::fetch(request)
        .await
        .map_err(|err| format!("proxy request failed: {err}"))?;
    let text =
        String::from_utf8(bytes).map_err(|err| format!("proxy response was not UTF-8: {err}"))?;
    serde_json::from_str(&text).map_err(|err| format!("proxy response was not JSON: {err}"))
}

pub fn read_string_path(value: &JsonValue, paths: &[&str]) -> Option<String> {
    for path in paths {
        let mut current = value;
        let mut found = true;
        for segment in path.split('.') {
            if let Some(next) = current.get(segment) {
                current = next;
            } else {
                found = false;
                break;
            }
        }
        if found {
            if let Some(text) = current.as_str().filter(|text| !text.is_empty()) {
                return Some(text.to_string());
            }
            if current.is_number() || current.is_boolean() {
                return Some(current.to_string());
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::engine::general_purpose::STANDARD;
    use serde_json::json;

    #[test]
    fn hmac_sha256_hex_matches_known_vector() {
        let digest = hmac_sha256_hex("key", "The quick brown fox jumps over the lazy dog").unwrap();
        assert_eq!(
            digest,
            "f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8"
        );
    }

    #[test]
    fn decode_32_byte_secret_accepts_hex_and_base64() {
        let bytes = [7u8; 32];
        let hex = hex::encode(bytes);
        let standard_base64 = STANDARD.encode(bytes);
        let url_safe_base64 = URL_SAFE_NO_PAD.encode(bytes);

        assert_eq!(decode_32_byte_secret(&hex).unwrap(), bytes);
        assert_eq!(decode_32_byte_secret(&standard_base64).unwrap(), bytes);
        assert_eq!(decode_32_byte_secret(&url_safe_base64).unwrap(), bytes);
    }

    #[test]
    fn decode_32_byte_secret_rejects_wrong_length() {
        let error = decode_32_byte_secret(&STANDARD.encode([1u8; 31])).unwrap_err();
        assert_eq!(error, "secret must decode to exactly 32 bytes");
    }

    #[test]
    fn join_url_normalizes_slashes() {
        assert_eq!(
            join_url("https://example.com/", "/path"),
            "https://example.com/path"
        );
    }

    #[test]
    fn read_string_path_reads_nested_scalars() {
        let value = json!({
            "success": {
                "userKey": "abc",
                "count": 3,
                "active": true
            }
        });

        assert_eq!(
            read_string_path(&value, &["missing", "success.userKey"]),
            Some("abc".to_string())
        );
        assert_eq!(
            read_string_path(&value, &["success.count"]),
            Some("3".to_string())
        );
        assert_eq!(
            read_string_path(&value, &["success.active"]),
            Some("true".to_string())
        );
    }
}
