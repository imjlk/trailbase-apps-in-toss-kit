use serde_json::{Value as JsonValue, json};

use crate::{CommonResult, join_url, post_json_with_optional_bearer, read_string_path};

pub const TOSS_LOGIN_COMPLETE_PATH: &str = "/internal/apps-in-toss/toss-login/complete";
pub const TOSS_LOGIN_REMOVE_BY_USER_KEY_PATH: &str =
    "/internal/apps-in-toss/toss-login/remove-by-user-key";
pub const IAP_ORDER_STATUS_PATH: &str = "/internal/apps-in-toss/iap/order/status";
pub const PROMOTION_REWARD_GRANT_PATH: &str = "/internal/apps-in-toss/promotion/reward/grant";
pub const PROMOTION_REWARD_PREPARE_PATH: &str = "/internal/apps-in-toss/promotion/reward/prepare";
pub const PROMOTION_REWARD_EXECUTE_PATH: &str = "/internal/apps-in-toss/promotion/reward/execute";
pub const PROMOTION_REWARD_STATUS_PATH: &str = "/internal/apps-in-toss/promotion/reward/status";
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
    access_token: &str,
) -> CommonResult<JsonValue> {
    post_json_with_optional_bearer(
        &join_url(proxy_url, TOSS_LOGIN_REMOVE_BY_USER_KEY_PATH),
        json!({
          "tossUserKey": toss_user_key,
          "accessToken": access_token,
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

/// Prepare step of the three-step reward contract: issues a provider
/// transaction key and nothing else. The prepare endpoint takes no
/// recipient, so this helper deliberately sends an empty body — do not
/// attach user-key headers the API does not ask for.
pub async fn promotion_reward_prepare(
    proxy_url: &str,
    bearer_token: Option<&str>,
) -> CommonResult<JsonValue> {
    post_json_with_optional_bearer(
        &join_url(proxy_url, PROMOTION_REWARD_PREPARE_PATH),
        json!({}),
        bearer_token,
    )
    .await
}

/// Execute step of the three-step reward contract. `payload` must carry the
/// transaction key persisted for this ledger row (and the same recipient
/// context that row was created with); a keyless execute is rejected before
/// any network call. `prepare`'s `ok: true` only means a key was issued —
/// it is never a grant.
pub async fn promotion_reward_execute(
    proxy_url: &str,
    bearer_token: Option<&str>,
    payload: JsonValue,
) -> CommonResult<JsonValue> {
    require_provider_transaction_key(
        &payload,
        "persisted provider transaction key is required to execute",
    )?;
    post_json_with_optional_bearer(
        &join_url(proxy_url, PROMOTION_REWARD_EXECUTE_PATH),
        payload,
        bearer_token,
    )
    .await
}

/// Both execute and status lookups are keyed by the provider transaction
/// key; a missing or blank key is rejected before any network call.
fn require_provider_transaction_key(payload: &JsonValue, message: &str) -> CommonResult<()> {
    if payload
        .get("providerTransactionKey")
        .and_then(JsonValue::as_str)
        .is_none_or(|key| key.trim().is_empty())
    {
        return Err(message.into());
    }
    Ok(())
}

/// Query the persisted transaction key. This endpoint cannot allocate or execute
/// a promotion grant; keep the original key until its outcome is reconciled.
pub async fn promotion_reward_status(
    proxy_url: &str,
    bearer_token: Option<&str>,
    promotion_code: &str,
    provider_transaction_key: &str,
    toss_user_key: &str,
    provider_request_id: &str,
) -> CommonResult<JsonValue> {
    if provider_transaction_key.trim().is_empty() {
        return Err("provider transaction key is required for result lookup".into());
    }
    post_json_with_optional_bearer(
        &join_url(proxy_url, PROMOTION_REWARD_STATUS_PATH),
        json!({
            "promotionCode": promotion_code,
            "providerTransactionKey": provider_transaction_key,
            "tossUserKey": toss_user_key,
            "providerRequestId": provider_request_id,
        }),
        bearer_token,
    )
    .await
}

/// Status lookup for an explicitly typed recipient payload, including anonKey.
pub async fn promotion_reward_status_with_payload(
    proxy_url: &str,
    bearer_token: Option<&str>,
    payload: JsonValue,
) -> CommonResult<JsonValue> {
    require_provider_transaction_key(
        &payload,
        "provider transaction key is required for result lookup",
    )?;
    post_json_with_optional_bearer(
        &join_url(proxy_url, PROMOTION_REWARD_STATUS_PATH),
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
            PROMOTION_REWARD_PREPARE_PATH,
            "/internal/apps-in-toss/promotion/reward/prepare"
        );
        assert_eq!(
            PROMOTION_REWARD_EXECUTE_PATH,
            "/internal/apps-in-toss/promotion/reward/execute"
        );
        assert_eq!(
            PROMOTION_REWARD_STATUS_PATH,
            "/internal/apps-in-toss/promotion/reward/status"
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

    #[test]
    fn execute_and_status_payloads_require_a_transaction_key() {
        let cases = [
            json!({ "promotionCode": "promo", "tossUserKey": "user" }),
            json!({ "providerTransactionKey": "   " }),
            json!({}),
        ];
        for payload in &cases {
            let error = require_provider_transaction_key(
                payload,
                "persisted provider transaction key is required to execute",
            )
            .unwrap_err();
            assert!(error.to_string().contains("transaction key is required"));
        }
        assert!(
            require_provider_transaction_key(
                &json!({ "providerTransactionKey": "key-1" }),
                "persisted provider transaction key is required to execute",
            )
            .is_ok()
        );
    }
}
