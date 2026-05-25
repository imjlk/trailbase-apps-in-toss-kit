use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use serde::{Deserialize, Serialize};
use trailbase_wasm::http::{Method, Request, StatusCode};
use url::form_urlencoded;

use crate::responses::{ApiError, ApiResult, bad_request, unauthorized};
use crate::settings;

pub const DEFAULT_UNLINK_CALLBACK_METHODS: &str = "POST";
pub const TOSS_LOGIN_UNLINK_BASIC_AUTH_KEY: &str = "TOSS_LOGIN_UNLINK_BASIC_AUTH";
pub const TOSS_UNLINK_CALLBACK_BASIC_AUTH_KEY: &str = "TOSS_UNLINK_CALLBACK_BASIC_AUTH";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TossUnlinkCallbackMethod {
    Get,
    Post,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TossUnlinkCallback {
    pub user_key: String,
    pub referrer: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TossUnlinkJsonBody {
    #[serde(default, alias = "user_key")]
    user_key: Option<String>,
    #[serde(default)]
    referrer: Option<String>,
}

pub fn ensure_allowed_method_from_settings(req: &Request, setting_name: &str) -> ApiResult<()> {
    let configured = settings::string_or(setting_name, DEFAULT_UNLINK_CALLBACK_METHODS);
    ensure_allowed_method(req.method(), configured.as_str())
}

pub fn ensure_allowed_method(method: &Method, configured: &str) -> ApiResult<()> {
    let request_method = callback_method_from_http(method).ok_or_else(|| {
        ApiError::new(
            StatusCode::METHOD_NOT_ALLOWED,
            "UNLINK_METHOD_NOT_ALLOWED",
            "Toss unlink callback method is not allowed",
        )
    })?;
    if parse_allowed_methods(configured).contains(&request_method) {
        return Ok(());
    }
    Err(ApiError::new(
        StatusCode::METHOD_NOT_ALLOWED,
        "UNLINK_METHOD_NOT_ALLOWED",
        "Toss unlink callback method is not allowed",
    ))
}

pub fn parse_allowed_methods(configured: &str) -> Vec<TossUnlinkCallbackMethod> {
    let mut methods = Vec::new();
    for part in configured.split(',') {
        match part.trim().to_ascii_uppercase().as_str() {
            "GET" if !methods.contains(&TossUnlinkCallbackMethod::Get) => {
                methods.push(TossUnlinkCallbackMethod::Get);
            }
            "POST" if !methods.contains(&TossUnlinkCallbackMethod::Post) => {
                methods.push(TossUnlinkCallbackMethod::Post);
            }
            _ => {}
        }
    }
    if methods.is_empty() {
        methods.push(TossUnlinkCallbackMethod::Post);
    }
    methods
}

pub async fn parse_callback(req: &mut Request) -> ApiResult<TossUnlinkCallback> {
    let query_user_key = req
        .query_param("userKey")
        .or_else(|| req.query_param("user_key"));
    if let Some(user_key) = query_user_key {
        return callback_from_fields(Some(user_key), req.query_param("referrer"));
    }

    let content_type = req
        .header("content-type")
        .or_else(|| req.header("Content-Type"))
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
        .to_string();
    let body = req
        .body()
        .bytes()
        .await
        .map_err(|err| bad_request("INVALID_BODY", format!("Invalid request body: {err}")))?;
    parse_callback_body(&body, content_type.as_str())
}

pub fn parse_callback_body(body: &[u8], content_type: &str) -> ApiResult<TossUnlinkCallback> {
    if body.is_empty() {
        return Err(bad_request("MISSING_USER_KEY", "Missing userKey"));
    }

    if content_type
        .to_ascii_lowercase()
        .contains("application/x-www-form-urlencoded")
    {
        return parse_callback_form_body(body);
    }

    match serde_json::from_slice::<TossUnlinkJsonBody>(body) {
        Ok(parsed) => callback_from_fields(parsed.user_key, parsed.referrer),
        Err(json_error) => parse_callback_form_body(body).map_err(|form_error| {
            if form_error.code == "MISSING_USER_KEY" {
                form_error
            } else {
                bad_request(
                    "INVALID_BODY",
                    format!("Invalid unlink callback body: {json_error}"),
                )
            }
        }),
    }
}

pub fn callback_from_fields(
    user_key: Option<String>,
    referrer: Option<String>,
) -> ApiResult<TossUnlinkCallback> {
    let user_key = user_key
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| bad_request("MISSING_USER_KEY", "Missing userKey"))?;
    validate_unlink_user_key(user_key.as_str())?;
    Ok(TossUnlinkCallback {
        user_key,
        referrer: normalize_unlink_referrer(referrer.as_deref()),
    })
}

pub fn validate_unlink_user_key(user_key: &str) -> ApiResult<()> {
    if user_key.trim().is_empty() || user_key.len() > 512 {
        return Err(bad_request("INVALID_USER_KEY", "Invalid userKey"));
    }
    Ok(())
}

pub fn normalize_unlink_referrer(referrer: Option<&str>) -> String {
    match referrer.unwrap_or("").trim().to_ascii_uppercase().as_str() {
        "UNLINK" => "UNLINK".to_string(),
        "WITHDRAWAL_TERMS" => "WITHDRAWAL_TERMS".to_string(),
        "WITHDRAWAL_TOSS" => "WITHDRAWAL_TOSS".to_string(),
        other if !other.is_empty() => other.to_string(),
        _ => "UNLINK".to_string(),
    }
}

pub fn is_withdrawal_referrer(referrer: &str) -> bool {
    matches!(
        referrer.trim().to_ascii_uppercase().as_str(),
        "WITHDRAWAL_TERMS" | "WITHDRAWAL_TOSS"
    )
}

pub fn verify_basic_auth_from_settings(req: &Request) -> ApiResult<()> {
    let expected = settings::string(TOSS_LOGIN_UNLINK_BASIC_AUTH_KEY)
        .or_else(|| settings::string(TOSS_UNLINK_CALLBACK_BASIC_AUTH_KEY))
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            unauthorized(
                "UNLINK_BASIC_AUTH_REQUIRED",
                "Toss unlink callback Basic Auth is not configured",
            )
        })?;
    let header_value = req
        .header("authorization")
        .or_else(|| req.header("Authorization"))
        .and_then(|value| value.to_str().ok());
    verify_basic_auth(expected.as_str(), header_value)
        .map_err(|message| unauthorized("UNAUTHORIZED", message))
}

pub fn verify_basic_auth(expected: &str, authorization_header: Option<&str>) -> Result<(), String> {
    let expected = expected.trim();
    if expected.is_empty() {
        return Err("Toss unlink callback Basic Auth is not configured".to_string());
    }

    let header = authorization_header.unwrap_or("").trim();
    if expected.starts_with("Basic ") && header == expected {
        return Ok(());
    }

    let Some((scheme, encoded)) = header.split_once(' ') else {
        return Err("Missing Basic Auth".to_string());
    };
    if !scheme.eq_ignore_ascii_case("Basic") || encoded.trim().is_empty() {
        return Err("Missing Basic Auth".to_string());
    }

    let decoded = STANDARD
        .decode(encoded.trim())
        .ok()
        .and_then(|bytes| String::from_utf8(bytes).ok())
        .ok_or_else(|| "Invalid Basic Auth".to_string())?;
    if decoded == expected {
        Ok(())
    } else {
        Err("Invalid Basic Auth".to_string())
    }
}

fn parse_callback_form_body(body: &[u8]) -> ApiResult<TossUnlinkCallback> {
    let mut user_key = None;
    let mut referrer = None;
    for (key, value) in form_urlencoded::parse(body) {
        match key.as_ref() {
            "userKey" | "user_key" => user_key = Some(value.into_owned()),
            "referrer" => referrer = Some(value.into_owned()),
            _ => {}
        }
    }
    callback_from_fields(user_key, referrer)
}

fn callback_method_from_http(method: &Method) -> Option<TossUnlinkCallbackMethod> {
    match *method {
        Method::GET => Some(TossUnlinkCallbackMethod::Get),
        Method::POST => Some(TossUnlinkCallbackMethod::Post),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::engine::general_purpose::STANDARD;

    #[test]
    fn defaults_allowed_methods_to_post() {
        assert_eq!(
            parse_allowed_methods(""),
            vec![TossUnlinkCallbackMethod::Post]
        );
        assert_eq!(
            parse_allowed_methods("GET,POST"),
            vec![
                TossUnlinkCallbackMethod::Get,
                TossUnlinkCallbackMethod::Post
            ]
        );
        assert_eq!(
            parse_allowed_methods("post, nope, GET"),
            vec![
                TossUnlinkCallbackMethod::Post,
                TossUnlinkCallbackMethod::Get
            ]
        );
    }

    #[test]
    fn validates_allowed_methods() {
        assert!(ensure_allowed_method(&Method::POST, "POST").is_ok());
        assert!(ensure_allowed_method(&Method::GET, "GET,POST").is_ok());
        assert_eq!(
            ensure_allowed_method(&Method::GET, "POST")
                .unwrap_err()
                .status,
            StatusCode::METHOD_NOT_ALLOWED
        );
    }

    #[test]
    fn parses_json_body_shapes() {
        let parsed = parse_callback_body(
            br#"{"userKey":"uk_1","referrer":"withdrawal_terms"}"#,
            "application/json",
        )
        .unwrap();

        assert_eq!(parsed.user_key, "uk_1");
        assert_eq!(parsed.referrer, "WITHDRAWAL_TERMS");

        let parsed = parse_callback_body(br#"{"user_key":"uk_2"}"#, "application/json").unwrap();
        assert_eq!(parsed.user_key, "uk_2");
        assert_eq!(parsed.referrer, "UNLINK");
    }

    #[test]
    fn parses_form_body_shapes() {
        let parsed = parse_callback_body(
            b"user_key=uk_1&referrer=WITHDRAWAL_TOSS",
            "application/x-www-form-urlencoded",
        )
        .unwrap();
        assert_eq!(parsed.user_key, "uk_1");
        assert_eq!(parsed.referrer, "WITHDRAWAL_TOSS");
    }

    #[test]
    fn verifies_basic_auth_from_raw_or_preencoded_expected() {
        let header = format!("Basic {}", STANDARD.encode("user:password"));
        assert!(verify_basic_auth("user:password", Some(&header)).is_ok());
        assert!(verify_basic_auth(&header, Some(&header)).is_ok());
        assert_eq!(
            verify_basic_auth("user:password", Some("Bearer nope")).unwrap_err(),
            "Missing Basic Auth"
        );
        assert_eq!(
            verify_basic_auth("user:password", Some("Basic nope")).unwrap_err(),
            "Invalid Basic Auth"
        );
    }

    #[test]
    fn classifies_withdrawal_referrers() {
        assert!(is_withdrawal_referrer("WITHDRAWAL_TERMS"));
        assert!(is_withdrawal_referrer("withdrawal_toss"));
        assert!(!is_withdrawal_referrer("UNLINK"));
    }
}
