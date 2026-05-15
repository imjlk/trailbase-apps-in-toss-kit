use serde_json::{Value as JsonValue, json};
use trailbase_wasm::fetch;
use trailbase_wasm::http::IntoBody;

use crate::{CommonResult, join_url, read_string_path};

pub const APPS_IN_TOSS_API_BASE_URL: &str = "https://apps-in-toss-api.toss.im";
pub const TOSS_LOGIN_GENERATE_TOKEN_PATH: &str =
    "/api-partner/v1/apps-in-toss/user/oauth2/generate-token";
pub const TOSS_LOGIN_ME_PATH: &str = "/api-partner/v1/apps-in-toss/user/oauth2/login-me";

pub async fn resolve_toss_user_key(
    api_base_url: &str,
    authorization_code: &str,
    referrer: &str,
) -> CommonResult<String> {
    let token_response =
        generate_toss_login_token(api_base_url, authorization_code, referrer).await?;
    let access_token =
        access_token_from_generate_token_response(&token_response).ok_or_else(|| {
            toss_login_error_reason(&token_response, "Toss login response missing accessToken")
        })?;

    let user_response = fetch_toss_login_user(api_base_url, &access_token).await?;
    user_key_from_login_me_response(&user_response).ok_or_else(|| {
        toss_login_error_reason(&user_response, "Toss login user response missing userKey")
    })
}

pub async fn generate_toss_login_token(
    api_base_url: &str,
    authorization_code: &str,
    referrer: &str,
) -> CommonResult<JsonValue> {
    let authorization_code = authorization_code.trim();
    if authorization_code.is_empty() {
        return Err("authorizationCode is required".to_string());
    }

    let request = fetch::Request::builder()
        .method("POST")
        .uri(join_url(api_base_url, TOSS_LOGIN_GENERATE_TOKEN_PATH))
        .header("Content-Type", "application/json")
        .body(
            json!({
              "authorizationCode": authorization_code,
              "referrer": normalize_login_referrer(referrer),
            })
            .to_string()
            .into_body(),
        )
        .map_err(|err| format!("failed to build Toss login token request: {err}"))?;
    fetch_json(request, "Toss login token request failed").await
}

pub async fn fetch_toss_login_user(
    api_base_url: &str,
    access_token: &str,
) -> CommonResult<JsonValue> {
    let request = fetch::Request::builder()
        .method("GET")
        .uri(join_url(api_base_url, TOSS_LOGIN_ME_PATH))
        .header("Authorization", format!("Bearer {access_token}"))
        .body(Vec::<u8>::new().into_body())
        .map_err(|err| format!("failed to build Toss login user request: {err}"))?;
    fetch_json(request, "Toss login user request failed").await
}

pub fn access_token_from_generate_token_response(response: &JsonValue) -> Option<String> {
    read_string_path(
        response,
        &[
            "success.accessToken",
            "accessToken",
            "data.accessToken",
            "success.access_token",
            "access_token",
            "data.access_token",
        ],
    )
}

pub fn user_key_from_login_me_response(response: &JsonValue) -> Option<String> {
    read_string_path(
        response,
        &[
            "success.userKey",
            "userKey",
            "data.userKey",
            "success.user_key",
            "user_key",
            "data.user_key",
        ],
    )
}

pub fn toss_login_error_reason(response: &JsonValue, fallback: &str) -> String {
    read_string_path(
        response,
        &[
            "error_description",
            "error.reason",
            "error.errorCode",
            "error",
            "failureReason",
            "message",
        ],
    )
    .unwrap_or_else(|| fallback.to_string())
}

pub fn normalize_login_referrer(referrer: &str) -> &'static str {
    if referrer.trim().eq_ignore_ascii_case("sandbox") {
        "sandbox"
    } else {
        "DEFAULT"
    }
}

async fn fetch_json(
    request: fetch::Request<trailbase_wasm::http::BoundedBody<Vec<u8>>>,
    error_message: &'static str,
) -> CommonResult<JsonValue> {
    let bytes = fetch::fetch(request)
        .await
        .map_err(|err| format!("{error_message}: {err}"))?;
    let text = String::from_utf8(bytes)
        .map_err(|err| format!("Toss login response was not UTF-8: {err}"))?;
    serde_json::from_str(&text).map_err(|err| format!("Toss login response was not JSON: {err}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn normalize_login_referrer_keeps_sandbox_lowercase() {
        assert_eq!(normalize_login_referrer("sandbox"), "sandbox");
        assert_eq!(normalize_login_referrer(" SANDBOX "), "sandbox");
        assert_eq!(normalize_login_referrer("DEFAULT"), "DEFAULT");
        assert_eq!(normalize_login_referrer(""), "DEFAULT");
    }

    #[test]
    fn reads_access_tokens_from_common_shapes() {
        assert_eq!(
            access_token_from_generate_token_response(&json!({
                "success": { "accessToken": "token-1" }
            })),
            Some("token-1".to_string())
        );
        assert_eq!(
            access_token_from_generate_token_response(&json!({
                "access_token": "token-2"
            })),
            Some("token-2".to_string())
        );
    }

    #[test]
    fn reads_user_keys_from_common_shapes() {
        assert_eq!(
            user_key_from_login_me_response(&json!({
                "success": { "userKey": 443731104 }
            })),
            Some("443731104".to_string())
        );
        assert_eq!(
            user_key_from_login_me_response(&json!({
                "user_key": "user-key-1"
            })),
            Some("user-key-1".to_string())
        );
    }

    #[test]
    fn reads_toss_login_error_reasons() {
        assert_eq!(
            toss_login_error_reason(
                &json!({ "error": { "reason": "invalid grant" } }),
                "fallback"
            ),
            "invalid grant"
        );
        assert_eq!(
            toss_login_error_reason(&json!({ "error": "invalid_grant" }), "fallback"),
            "invalid_grant"
        );
        assert_eq!(
            toss_login_error_reason(&json!({ "ok": false }), "fallback"),
            "fallback"
        );
    }

    #[test]
    fn exposes_current_apps_in_toss_login_paths() {
        assert_eq!(
            TOSS_LOGIN_GENERATE_TOKEN_PATH,
            "/api-partner/v1/apps-in-toss/user/oauth2/generate-token"
        );
        assert_eq!(
            TOSS_LOGIN_ME_PATH,
            "/api-partner/v1/apps-in-toss/user/oauth2/login-me"
        );
    }
}
