use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use trailbase_wasm::db::{Transaction, Value};

use crate::db;
use crate::read_string_path;
use crate::responses::{ApiResult, bad_request};
use crate::toss_identity_store;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum MessagePurpose {
    Functional,
    Marketing,
}

impl MessagePurpose {
    pub fn parse(value: &str) -> ApiResult<Self> {
        match value.trim().to_ascii_uppercase().as_str() {
            "FUNCTIONAL" => Ok(Self::Functional),
            "MARKETING" => Ok(Self::Marketing),
            _ => Err(bad_request(
                "INVALID_MESSAGE_PURPOSE",
                "message purpose must be FUNCTIONAL or MARKETING",
            )),
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Functional => "FUNCTIONAL",
            Self::Marketing => "MARKETING",
        }
    }

    pub fn requires_marketing_consent(self) -> bool {
        self == Self::Marketing
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum NotificationAgreementResult {
    NewAgreement,
    AlreadyAgreed,
    AgreementRejected,
}

impl NotificationAgreementResult {
    pub fn parse(value: &str) -> ApiResult<Self> {
        match value.trim() {
            "newAgreement" => Ok(Self::NewAgreement),
            "alreadyAgreed" => Ok(Self::AlreadyAgreed),
            "agreementRejected" => Ok(Self::AgreementRejected),
            _ => Err(bad_request(
                "INVALID_NOTIFICATION_AGREEMENT_RESULT",
                "notification agreement result is invalid",
            )),
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::NewAgreement => "newAgreement",
            Self::AlreadyAgreed => "alreadyAgreed",
            Self::AgreementRejected => "agreementRejected",
        }
    }

    pub fn consent_status(self) -> &'static str {
        match self {
            Self::NewAgreement | Self::AlreadyAgreed => "OPTED_IN",
            Self::AgreementRejected => "OPTED_OUT",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageProviderResponse {
    pub ok: bool,
    pub provider_request_id: String,
    pub provider_status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sent_at: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failure_reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider_error_code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub msg_count: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sent_push_count: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sent_inbox_count: Option<i64>,
}

impl MessageProviderResponse {
    pub fn is_sent(&self) -> bool {
        self.provider_status == "SENT"
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageDispatchGate {
    pub allowed: bool,
    pub purpose: MessagePurpose,
    pub template_code: String,
    pub requires_template_agreement: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub skip_reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub template_status: Option<String>,
}

pub fn normalize_message_purpose(value: &str) -> ApiResult<MessagePurpose> {
    MessagePurpose::parse(value)
}

pub fn parse_message_proxy_response(
    value: &JsonValue,
    fallback_provider_request_id: &str,
    fallback_sent_at: Option<i64>,
) -> MessageProviderResponse {
    let ok = value.get("ok").and_then(JsonValue::as_bool).unwrap_or(true);
    let provider_request_id = read_string_path(
        value,
        &[
            "providerRequestId",
            "requestId",
            "messageId",
            "result.providerRequestId",
        ],
    )
    .unwrap_or_else(|| fallback_provider_request_id.to_string());
    let raw_status = read_string_path(value, &["providerStatus", "status", "resultType"])
        .unwrap_or_else(|| if ok { "SENT" } else { "FAILED" }.to_string());
    let provider_status = normalize_provider_status(&raw_status, ok);
    MessageProviderResponse {
        ok: ok && provider_status == "SENT",
        provider_request_id,
        provider_status,
        result_type: read_string_path(value, &["resultType"]),
        sent_at: read_i64_path(value, &["sentAt"]).or(fallback_sent_at),
        failure_reason: read_string_path(
            value,
            &[
                "failureReason",
                "reachFailReason",
                "error.reason",
                "error.errorMessage",
                "error.message",
                "message",
                "error",
            ],
        ),
        provider_error_code: read_string_path(
            value,
            &[
                "providerErrorCode",
                "errorCode",
                "code",
                "error.errorCode",
                "error.code",
            ],
        ),
        msg_count: read_i64_path(value, &["msgCount"]),
        sent_push_count: read_i64_path(value, &["sentPushCount"]),
        sent_inbox_count: read_i64_path(value, &["sentInboxCount"]),
    }
}

pub fn normalize_provider_status(status: &str, ok: bool) -> String {
    let normalized = status.trim().to_ascii_uppercase();
    if !ok {
        return "FAILED".to_string();
    }
    match normalized.as_str() {
        "SENT" | "SUCCESS" | "SUCCEEDED" | "OK" | "DONE" | "COMPLETED" => "SENT".to_string(),
        "FAILED" | "FAIL" | "ERROR" | "HTTP_TIMEOUT" | "NETWORK_ERROR" | "EXECUTION_FAIL"
        | "INTERRUPTED" | "INTERNAL_ERROR" => "FAILED".to_string(),
        "" => "SENT".to_string(),
        other => other.to_string(),
    }
}

pub fn message_dispatch_gate_for_trailbase_user_tx(
    tx: &mut Transaction,
    user: &[u8],
    purpose: MessagePurpose,
    template_code: &str,
) -> ApiResult<MessageDispatchGate> {
    let mut requires_template_agreement = false;
    let mut template_status = None;
    if let Some(template) = message_template_tx(tx, template_code)? {
        template_status = Some(template.status.clone());
        if template.purpose != purpose {
            return Ok(MessageDispatchGate {
                allowed: false,
                purpose,
                template_code: template_code.to_string(),
                requires_template_agreement: template.requires_agreement,
                skip_reason: Some("template_purpose_mismatch".to_string()),
                template_status,
            });
        }
        if template.status != "APPROVED" {
            return Ok(MessageDispatchGate {
                allowed: false,
                purpose,
                template_code: template_code.to_string(),
                requires_template_agreement: template.requires_agreement,
                skip_reason: Some("template_not_approved".to_string()),
                template_status,
            });
        }
        requires_template_agreement = template.requires_agreement;
    }

    if purpose.requires_marketing_consent() && !marketing_opted_in_tx(tx, user)? {
        return Ok(MessageDispatchGate {
            allowed: false,
            purpose,
            template_code: template_code.to_string(),
            requires_template_agreement,
            skip_reason: Some("marketing_not_opted_in".to_string()),
            template_status,
        });
    }

    if purpose == MessagePurpose::Functional
        && requires_template_agreement
        && !template_agreement_opted_in_tx(tx, user, template_code)?
    {
        return Ok(MessageDispatchGate {
            allowed: false,
            purpose,
            template_code: template_code.to_string(),
            requires_template_agreement,
            skip_reason: Some("functional_template_not_opted_in".to_string()),
            template_status,
        });
    }

    Ok(MessageDispatchGate {
        allowed: true,
        purpose,
        template_code: template_code.to_string(),
        requires_template_agreement,
        skip_reason: None,
        template_status,
    })
}

pub fn unseal_toss_user_key_for_message_tx(
    tx: &mut Transaction,
    user: &[u8],
    unseal: impl FnOnce(&str) -> Result<String, String>,
) -> ApiResult<String> {
    toss_identity_store::unseal_active_toss_user_key_for_trailbase_user_tx(tx, user, unseal)
}

pub fn skip_message_outbox_tx(
    tx: &mut Transaction,
    outbox_id: &[u8],
    reason: &str,
    now: i64,
) -> ApiResult<()> {
    db::tx_execute(
        tx,
        "UPDATE message_outbox
         SET status = 'SKIPPED',
             locked_at = NULL,
             failed_at = ?2,
             failure_reason = ?3,
             updated_at = ?2
         WHERE id = ?1",
        &[
            Value::Blob(outbox_id.to_vec()),
            Value::Integer(now),
            Value::Text(reason.to_string()),
        ],
    )?;
    Ok(())
}

pub fn complete_message_outbox_tx(
    tx: &mut Transaction,
    outbox_id: &[u8],
    response: &MessageProviderResponse,
    raw_response_json: Option<&str>,
    now: i64,
) -> ApiResult<()> {
    let sent_at = response.sent_at.unwrap_or(now);
    let status = if response.is_sent() { "SENT" } else { "FAILED" };
    db::tx_execute(
        tx,
        "UPDATE message_outbox
         SET status = ?2,
             locked_at = NULL,
             provider_request_id = ?3,
             provider_status = ?4,
             sent_at = CASE WHEN ?2 = 'SENT' THEN ?5 ELSE sent_at END,
             failed_at = CASE WHEN ?2 = 'FAILED' THEN ?7 ELSE failed_at END,
             failure_reason = ?6,
             provider_result_type = ?8,
             provider_msg_count = ?9,
             provider_sent_push_count = ?10,
             provider_sent_inbox_count = ?11,
             provider_response_json = ?12,
             updated_at = ?7
         WHERE id = ?1",
        &[
            Value::Blob(outbox_id.to_vec()),
            Value::Text(status.to_string()),
            Value::Text(response.provider_request_id.clone()),
            Value::Text(response.provider_status.clone()),
            Value::Integer(sent_at),
            optional_text(response.failure_reason.as_deref()),
            Value::Integer(now),
            optional_text(response.result_type.as_deref()),
            optional_i64(response.msg_count),
            optional_i64(response.sent_push_count),
            optional_i64(response.sent_inbox_count),
            optional_text(raw_response_json),
        ],
    )?;
    Ok(())
}

#[derive(Debug, Clone)]
struct MessageTemplate {
    purpose: MessagePurpose,
    status: String,
    requires_agreement: bool,
}

fn message_template_tx(
    tx: &mut Transaction,
    template_code: &str,
) -> ApiResult<Option<MessageTemplate>> {
    if !table_exists_tx(tx, "message_templates")? {
        return Ok(None);
    }
    let rows = db::tx_query(
        tx,
        "SELECT purpose, status, requires_agreement
         FROM message_templates
         WHERE template_code = ?1
         LIMIT 1",
        &[Value::Text(template_code.to_string())],
    )?;
    rows.first()
        .map(|row| {
            Ok(MessageTemplate {
                purpose: MessagePurpose::parse(&db::text(&row[0], "purpose")?)?,
                status: db::text(&row[1], "status")?,
                requires_agreement: db::integer(&row[2], "requires_agreement")? != 0,
            })
        })
        .transpose()
}

fn marketing_opted_in_tx(tx: &mut Transaction, user: &[u8]) -> ApiResult<bool> {
    if !table_exists_tx(tx, "notification_consents")? {
        return Ok(false);
    }
    let rows = db::tx_query(
        tx,
        "SELECT 1
         FROM notification_consents
         WHERE user_id = ?1
           AND purpose = 'MARKETING'
           AND status = 'OPTED_IN'
         LIMIT 1",
        &[Value::Blob(user.to_vec())],
    )?;
    Ok(!rows.is_empty())
}

fn template_agreement_opted_in_tx(
    tx: &mut Transaction,
    user: &[u8],
    template_code: &str,
) -> ApiResult<bool> {
    if !table_exists_tx(tx, "notification_template_agreements")? {
        return Ok(false);
    }
    let rows = db::tx_query(
        tx,
        "SELECT 1
         FROM notification_template_agreements
         WHERE user_id = ?1
           AND template_code = ?2
           AND status = 'OPTED_IN'
         LIMIT 1",
        &[
            Value::Blob(user.to_vec()),
            Value::Text(template_code.to_string()),
        ],
    )?;
    Ok(!rows.is_empty())
}

fn table_exists_tx(tx: &mut Transaction, table_name: &str) -> ApiResult<bool> {
    let rows = db::tx_query(
        tx,
        "SELECT 1
         FROM sqlite_master
         WHERE type IN ('table', 'view')
           AND name = ?1
         LIMIT 1",
        &[Value::Text(table_name.to_string())],
    )?;
    Ok(!rows.is_empty())
}

fn read_i64_path(value: &JsonValue, paths: &[&str]) -> Option<i64> {
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
            if let Some(number) = current.as_i64() {
                return Some(number);
            }
            if let Some(text) = current.as_str().and_then(|text| text.parse::<i64>().ok()) {
                return Some(text);
            }
        }
    }
    None
}

fn optional_text(value: Option<&str>) -> Value {
    value
        .filter(|text| !text.trim().is_empty())
        .map(|text| Value::Text(text.to_string()))
        .unwrap_or(Value::Null)
}

fn optional_i64(value: Option<i64>) -> Value {
    value.map(Value::Integer).unwrap_or(Value::Null)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_message_purpose() {
        assert_eq!(
            normalize_message_purpose("functional").unwrap(),
            MessagePurpose::Functional
        );
        assert_eq!(
            normalize_message_purpose("MARKETING").unwrap(),
            MessagePurpose::Marketing
        );
        assert!(normalize_message_purpose("promo").is_err());
    }

    #[test]
    fn maps_notification_agreement_result_to_status() {
        assert_eq!(
            NotificationAgreementResult::parse("newAgreement")
                .unwrap()
                .consent_status(),
            "OPTED_IN"
        );
        assert_eq!(
            NotificationAgreementResult::parse("alreadyAgreed")
                .unwrap()
                .consent_status(),
            "OPTED_IN"
        );
        assert_eq!(
            NotificationAgreementResult::parse("agreementRejected")
                .unwrap()
                .consent_status(),
            "OPTED_OUT"
        );
    }

    #[test]
    fn parses_proxy_message_counts_and_status() {
        let response = parse_message_proxy_response(
            &json!({
              "ok": true,
              "providerRequestId": "msg-1",
              "providerStatus": "SUCCESS",
              "resultType": "SUCCESS",
              "sentAt": 1234,
              "msgCount": 1,
              "sentPushCount": 1,
              "sentInboxCount": 0
            }),
            "fallback",
            None,
        );
        assert!(response.ok);
        assert_eq!(response.provider_status, "SENT");
        assert_eq!(response.provider_request_id, "msg-1");
        assert_eq!(response.result_type.as_deref(), Some("SUCCESS"));
        assert_eq!(response.msg_count, Some(1));
        assert_eq!(response.sent_push_count, Some(1));
        assert_eq!(response.sent_inbox_count, Some(0));
    }

    #[test]
    fn parses_proxy_message_failure() {
        let response = parse_message_proxy_response(
            &json!({
              "ok": false,
              "providerRequestId": "msg-2",
              "providerStatus": "FAILED",
              "resultType": "FAIL",
              "failureReason": "template is not approved",
              "providerErrorCode": "INVALID_TEMPLATE"
            }),
            "fallback",
            Some(999),
        );
        assert!(!response.ok);
        assert_eq!(response.provider_status, "FAILED");
        assert_eq!(response.sent_at, Some(999));
        assert_eq!(
            response.failure_reason.as_deref(),
            Some("template is not approved")
        );
        assert_eq!(
            response.provider_error_code.as_deref(),
            Some("INVALID_TEMPLATE")
        );
    }
}
