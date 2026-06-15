use serde_json::{Value as JsonValue, json};

use crate::{CommonResult, join_url, post_json_with_optional_bearer, read_string_path};

pub const TOSS_LOGIN_COMPLETE_PATH: &str = "/internal/apps-in-toss/toss-login/complete";
pub const TOSS_LOGIN_REMOVE_BY_USER_KEY_PATH: &str =
    "/internal/apps-in-toss/toss-login/remove-by-user-key";
pub const IAP_ORDER_STATUS_PATH: &str = "/internal/apps-in-toss/iap/order/status";
pub const PROMOTION_REWARD_GRANT_PATH: &str = "/internal/apps-in-toss/promotion/reward/grant";
pub const SMART_MESSAGE_SEND_PATH: &str = "/internal/apps-in-toss/smart-message/send";
pub const SMART_MESSAGE_BULK_SEND_PATH: &str = "/internal/apps-in-toss/smart-message/send-bulk";

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

pub async fn toss_login_remove_by_user_key(
    proxy_url: &str,
    bearer_token: Option<&str>,
    toss_user_key: &str,
) -> CommonResult<JsonValue> {
    post_json_with_optional_bearer(
        &join_url(proxy_url, TOSS_LOGIN_REMOVE_BY_USER_KEY_PATH),
        json!({
          "tossUserKey": toss_user_key,
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

pub async fn smart_message_bulk_send(
    proxy_url: &str,
    bearer_token: Option<&str>,
    payload: JsonValue,
) -> CommonResult<JsonValue> {
    post_json_with_optional_bearer(
        &join_url(proxy_url, SMART_MESSAGE_BULK_SEND_PATH),
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

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PromotionProviderSignal {
    Paused,
    Exhausted,
    Misconfigured,
}

pub fn promotion_provider_signal(
    provider_error_code: Option<&str>,
) -> Option<PromotionProviderSignal> {
    match provider_error_code.map(str::trim) {
        Some("4112" | "4116") => Some(PromotionProviderSignal::Exhausted),
        Some("4104" | "4105" | "4108" | "4109") => Some(PromotionProviderSignal::Paused),
        Some("4114") => Some(PromotionProviderSignal::Misconfigured),
        _ => None,
    }
}

pub fn promotion_provider_signal_from_response(
    response: &JsonValue,
) -> Option<PromotionProviderSignal> {
    let provider_error_code = read_string_path(
        response,
        &["providerErrorCode", "errorCode", "code", "error.code"],
    );
    promotion_provider_signal(provider_error_code.as_deref())
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
    fn promotion_provider_signal_classifies_operational_codes() {
        assert_eq!(
            promotion_provider_signal(Some("4112")),
            Some(PromotionProviderSignal::Exhausted)
        );
        assert_eq!(
            promotion_provider_signal(Some("4116")),
            Some(PromotionProviderSignal::Exhausted)
        );
        assert_eq!(
            promotion_provider_signal(Some("4109")),
            Some(PromotionProviderSignal::Paused)
        );
        assert_eq!(
            promotion_provider_signal(Some("4114")),
            Some(PromotionProviderSignal::Misconfigured)
        );
        assert_eq!(promotion_provider_signal(Some("9999")), None);
        assert_eq!(promotion_provider_signal(None), None);
    }

    #[test]
    fn promotion_provider_signal_reads_proxy_response_codes() {
        assert_eq!(
            promotion_provider_signal_from_response(&json!({ "providerErrorCode": "4116" })),
            Some(PromotionProviderSignal::Exhausted)
        );
        assert_eq!(
            promotion_provider_signal_from_response(&json!({ "error": { "code": 4109 } })),
            Some(PromotionProviderSignal::Paused)
        );
    }

    #[test]
    fn adapter_paths_use_internal_apps_in_toss_routes() {
        assert_eq!(
            TOSS_LOGIN_COMPLETE_PATH,
            "/internal/apps-in-toss/toss-login/complete"
        );
        assert_eq!(
            TOSS_LOGIN_REMOVE_BY_USER_KEY_PATH,
            "/internal/apps-in-toss/toss-login/remove-by-user-key"
        );
        assert_eq!(
            IAP_ORDER_STATUS_PATH,
            "/internal/apps-in-toss/iap/order/status"
        );
        assert_eq!(
            PROMOTION_REWARD_GRANT_PATH,
            "/internal/apps-in-toss/promotion/reward/grant"
        );
        assert_eq!(
            SMART_MESSAGE_SEND_PATH,
            "/internal/apps-in-toss/smart-message/send"
        );
        assert_eq!(
            SMART_MESSAGE_BULK_SEND_PATH,
            "/internal/apps-in-toss/smart-message/send-bulk"
        );
    }
}
