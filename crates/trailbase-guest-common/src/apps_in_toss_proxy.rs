use serde_json::{Value as JsonValue, json};

use crate::{CommonResult, join_url, post_json_with_optional_bearer, read_string_path};

pub const TOSS_LOGIN_COMPLETE_PATH: &str = "/internal/apps-in-toss/toss-login/complete";
pub const IAP_ORDER_STATUS_PATH: &str = "/internal/apps-in-toss/iap/order/status";
pub const PROMOTION_REWARD_GRANT_PATH: &str = "/internal/apps-in-toss/promotion/reward/grant";
pub const SMART_MESSAGE_SEND_PATH: &str = "/internal/apps-in-toss/smart-message/send";

pub async fn toss_login_complete(
    proxy_url: &str,
    bearer_token: Option<&str>,
    authorization_code: &str,
    referrer: &str,
) -> CommonResult<JsonValue> {
    post_json_with_optional_bearer(
        &join_url(proxy_url, TOSS_LOGIN_COMPLETE_PATH),
        json!({
          "authorizationCode": authorization_code,
          "referrer": referrer,
        }),
        bearer_token,
    )
    .await
}

pub async fn iap_order_status(
    proxy_url: &str,
    bearer_token: Option<&str>,
    order_id: &str,
    sku: &str,
    toss_user_key: &str,
) -> CommonResult<JsonValue> {
    post_json_with_optional_bearer(
        &join_url(proxy_url, IAP_ORDER_STATUS_PATH),
        json!({
          "orderId": order_id,
          "sku": sku,
          "tossUserKey": toss_user_key,
        }),
        bearer_token,
    )
    .await
}

pub async fn promotion_reward_grant(
    proxy_url: &str,
    bearer_token: Option<&str>,
    payload: JsonValue,
) -> CommonResult<JsonValue> {
    post_json_with_optional_bearer(
        &join_url(proxy_url, PROMOTION_REWARD_GRANT_PATH),
        payload,
        bearer_token,
    )
    .await
}

pub async fn smart_message_send(
    proxy_url: &str,
    bearer_token: Option<&str>,
    payload: JsonValue,
) -> CommonResult<JsonValue> {
    post_json_with_optional_bearer(
        &join_url(proxy_url, SMART_MESSAGE_SEND_PATH),
        payload,
        bearer_token,
    )
    .await
}

pub fn proxy_response_failed(response: &JsonValue) -> bool {
    response.get("ok").and_then(JsonValue::as_bool) == Some(false)
}

pub fn proxy_failure_message(response: &JsonValue, fallback: &str) -> String {
    read_string_path(response, &["failureReason", "message", "error"])
        .unwrap_or_else(|| fallback.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn proxy_response_failed_only_matches_explicit_false() {
        assert!(proxy_response_failed(&json!({ "ok": false })));
        assert!(!proxy_response_failed(&json!({ "ok": true })));
        assert!(!proxy_response_failed(&json!({ "status": "FAILED" })));
    }

    #[test]
    fn proxy_failure_message_reads_common_fields() {
        assert_eq!(
            proxy_failure_message(&json!({ "failureReason": "nope" }), "fallback"),
            "nope"
        );
        assert_eq!(
            proxy_failure_message(&json!({ "message": "bad" }), "fallback"),
            "bad"
        );
        assert_eq!(
            proxy_failure_message(&json!({ "error": "failed" }), "fallback"),
            "failed"
        );
        assert_eq!(
            proxy_failure_message(&json!({ "ok": false }), "fallback"),
            "fallback"
        );
    }

    #[test]
    fn adapter_paths_use_internal_apps_in_toss_routes() {
        assert_eq!(
            PROMOTION_REWARD_GRANT_PATH,
            "/internal/apps-in-toss/promotion/reward/grant"
        );
        assert_eq!(
            SMART_MESSAGE_SEND_PATH,
            "/internal/apps-in-toss/smart-message/send"
        );
    }
}
