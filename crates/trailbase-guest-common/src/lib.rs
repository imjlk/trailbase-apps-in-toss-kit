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
