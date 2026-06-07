use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use trailbase_wasm::db::{Transaction, Value};

use crate::db;
use crate::read_string_path;
use crate::responses::{ApiResult, bad_request, internal};
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

pub const APPS_IN_TOSS_NOTIFICATION_AGREEMENT_SDK_SOURCE: &str = "apps_in_toss_sdk";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationTemplateAgreementRecord {
    pub id: String,
    pub user_id: Vec<u8>,
    pub template_code: String,
    pub status: String,
    pub source: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_result: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
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
    pub requires_notification_agreement: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notification_template_code: Option<String>,
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
    let mut requires_notification_agreement = false;
    let mut notification_template_code = None;
    let mut template_status = None;
    let template_registry_exists = table_exists_tx(tx, "message_templates")?;
    if let Some(template) = message_template_tx(tx, template_code)? {
        template_status = Some(template.status.clone());
        if template.purpose != purpose {
            return Ok(MessageDispatchGate {
                allowed: false,
                purpose,
                template_code: template_code.to_string(),
                requires_notification_agreement: template.requires_agreement,
                notification_template_code: template.notification_template_code,
                skip_reason: Some("template_purpose_mismatch".to_string()),
                template_status,
            });
        }
        if template.status != "APPROVED" {
            return Ok(MessageDispatchGate {
                allowed: false,
                purpose,
                template_code: template_code.to_string(),
                requires_notification_agreement: template.requires_agreement,
                notification_template_code: template.notification_template_code,
                skip_reason: Some("template_not_approved".to_string()),
                template_status,
            });
        }
        requires_notification_agreement = template.requires_agreement;
        notification_template_code = template.notification_template_code;
    } else if template_registry_exists {
        return Ok(MessageDispatchGate {
            allowed: false,
            purpose,
            template_code: template_code.to_string(),
            requires_notification_agreement: false,
            notification_template_code: None,
            skip_reason: Some("template_not_found".to_string()),
            template_status: None,
        });
    }

    if purpose.requires_marketing_consent() && !marketing_opted_in_tx(tx, user)? {
        return Ok(MessageDispatchGate {
            allowed: false,
            purpose,
            template_code: template_code.to_string(),
            requires_notification_agreement,
            notification_template_code,
            skip_reason: Some("marketing_not_opted_in".to_string()),
            template_status,
        });
    }

    if purpose == MessagePurpose::Functional && requires_notification_agreement {
        let Some(required_notification_template_code) = notification_template_code
            .as_deref()
            .filter(|code| !code.trim().is_empty())
        else {
            return Ok(MessageDispatchGate {
                allowed: false,
                purpose,
                template_code: template_code.to_string(),
                requires_notification_agreement,
                notification_template_code,
                skip_reason: Some(
                    "functional_template_missing_notification_template_code".to_string(),
                ),
                template_status,
            });
        };

        if !notification_template_opted_in_tx(tx, user, required_notification_template_code)? {
            return Ok(MessageDispatchGate {
                allowed: false,
                purpose,
                template_code: template_code.to_string(),
                requires_notification_agreement,
                notification_template_code,
                skip_reason: Some("functional_template_not_opted_in".to_string()),
                template_status,
            });
        }
    }

    Ok(MessageDispatchGate {
        allowed: true,
        purpose,
        template_code: template_code.to_string(),
        requires_notification_agreement,
        notification_template_code,
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

pub fn upsert_notification_template_agreement_tx(
    tx: &mut Transaction,
    user: &[u8],
    template_code: &str,
    result: NotificationAgreementResult,
    source: &str,
    now: i64,
) -> ApiResult<NotificationTemplateAgreementRecord> {
    if !table_exists_tx(tx, "notification_template_agreements")? {
        return Err(internal(
            "notification_template_agreements table is missing",
        ));
    }

    let template_code = normalize_required_text(template_code, "templateCode")?;
    let source = normalize_optional_text(source, APPS_IN_TOSS_NOTIFICATION_AGREEMENT_SDK_SOURCE);
    let status = result.consent_status();
    let last_result = result.as_str();
    let code_column = notification_agreement_code_column_tx(tx)?;
    let sql = format!(
        "INSERT INTO notification_template_agreements (
           id, user_id, {code_column}, status, source, last_result, created_at, updated_at
         )
         VALUES (
           lower(hex(randomblob(16))), ?1, ?2, ?3, ?4, ?5, ?6, ?6
         )
         ON CONFLICT(user_id, {code_column}) DO UPDATE SET
           status = excluded.status,
           source = excluded.source,
           last_result = excluded.last_result,
           updated_at = excluded.updated_at
         RETURNING id, user_id, {code_column}, status, source, last_result, created_at, updated_at"
    );
    let rows = db::tx_query(
        tx,
        &sql,
        &[
            Value::Blob(user.to_vec()),
            Value::Text(template_code),
            Value::Text(status.to_string()),
            Value::Text(source),
            Value::Text(last_result.to_string()),
            Value::Integer(now),
        ],
    )?;
    let row = rows
        .first()
        .ok_or_else(|| internal("Failed to upsert notification template agreement"))?;
    notification_template_agreement_from_row(row)
}

pub fn skip_message_outbox_tx(
    tx: &mut Transaction,
    outbox_id: &str,
    reason: &str,
    now: i64,
) -> ApiResult<()> {
    let updated = db::tx_execute(
        tx,
        "UPDATE message_outbox
         SET status = 'SKIPPED',
             locked_at = NULL,
             failed_at = ?2,
             failure_reason = ?3,
             updated_at = ?2
         WHERE id = ?1",
        &[
            Value::Text(outbox_id.to_string()),
            Value::Integer(now),
            Value::Text(reason.to_string()),
        ],
    )?;
    if updated == 0 {
        return Err(internal("Message outbox row was not found for skip"));
    }
    Ok(())
}

pub fn complete_message_outbox_tx(
    tx: &mut Transaction,
    outbox_id: &str,
    response: &MessageProviderResponse,
    raw_response_json: Option<&str>,
    now: i64,
) -> ApiResult<()> {
    let sent_at = response.sent_at.unwrap_or(now);
    let status = if response.is_sent() { "SENT" } else { "FAILED" };
    let updated = db::tx_execute(
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
            Value::Text(outbox_id.to_string()),
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
    if updated == 0 {
        return Err(internal("Message outbox row was not found for completion"));
    }
    Ok(())
}

#[derive(Debug, Clone)]
struct MessageTemplate {
    purpose: MessagePurpose,
    status: String,
    requires_agreement: bool,
    notification_template_code: Option<String>,
}

fn message_template_tx(
    tx: &mut Transaction,
    template_code: &str,
) -> ApiResult<Option<MessageTemplate>> {
    if !table_exists_tx(tx, "message_templates")? {
        return Ok(None);
    }
    let Some(notification_code_column) = message_template_notification_code_column_tx(tx)? else {
        return legacy_message_template_tx(tx, template_code);
    };
    let rows = db::tx_query(
        tx,
        &format!(
            "SELECT purpose, status, requires_agreement, {notification_code_column}
         FROM message_templates
         WHERE template_code = ?1
         LIMIT 1"
        ),
        &[Value::Text(template_code.to_string())],
    )?;
    rows.first()
        .map(|row| message_template_from_row(row))
        .transpose()
}

fn legacy_message_template_tx(
    tx: &mut Transaction,
    template_code: &str,
) -> ApiResult<Option<MessageTemplate>> {
    let rows = db::tx_query(
        tx,
        "SELECT purpose, status, requires_agreement
         FROM message_templates
         WHERE template_code = ?1
         LIMIT 1",
        &[Value::Text(template_code.to_string())],
    )?;
    rows.first()
        .map(|row| legacy_message_template_from_row(row, template_code))
        .transpose()
}

fn message_template_from_row(row: &[Value]) -> ApiResult<MessageTemplate> {
    Ok(MessageTemplate {
        purpose: MessagePurpose::parse(&db::text(&row[0], "purpose")?)?,
        status: db::text(&row[1], "status")?,
        requires_agreement: db::integer(&row[2], "requires_agreement")? != 0,
        notification_template_code: normalize_optional_code(db::nullable_text(&row[3])?),
    })
}

fn legacy_message_template_from_row(
    row: &[Value],
    template_code: &str,
) -> ApiResult<MessageTemplate> {
    let requires_agreement = db::integer(&row[2], "requires_agreement")? != 0;
    Ok(MessageTemplate {
        purpose: MessagePurpose::parse(&db::text(&row[0], "purpose")?)?,
        status: db::text(&row[1], "status")?,
        requires_agreement,
        notification_template_code: if requires_agreement {
            normalize_optional_code(Some(template_code.to_string()))
        } else {
            None
        },
    })
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

fn notification_template_opted_in_tx(
    tx: &mut Transaction,
    user: &[u8],
    template_code: &str,
) -> ApiResult<bool> {
    if !table_exists_tx(tx, "notification_template_agreements")? {
        return Ok(false);
    }
    let template_code = normalize_required_text(template_code, "templateCode")?;
    let code_column = notification_agreement_code_column_tx(tx)?;
    let sql = format!(
        "SELECT 1
         FROM notification_template_agreements
         WHERE user_id = ?1
           AND {code_column} = ?2
           AND status = 'OPTED_IN'
         LIMIT 1"
    );
    let rows = db::tx_query(
        tx,
        &sql,
        &[Value::Blob(user.to_vec()), Value::Text(template_code)],
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

fn notification_agreement_code_column_tx(tx: &mut Transaction) -> ApiResult<&'static str> {
    if table_has_column_tx(tx, "notification_template_agreements", "template_code")? {
        Ok("template_code")
    } else if table_has_column_tx(
        tx,
        "notification_template_agreements",
        "agreement_template_code",
    )? {
        Ok("agreement_template_code")
    } else {
        Err(internal(
            "notification_template_agreements code column is missing",
        ))
    }
}

fn message_template_notification_code_column_tx(
    tx: &mut Transaction,
) -> ApiResult<Option<&'static str>> {
    if table_has_column_tx(tx, "message_templates", "notification_template_code")? {
        Ok(Some("notification_template_code"))
    } else if table_has_column_tx(tx, "message_templates", "agreement_template_code")? {
        Ok(Some("agreement_template_code"))
    } else {
        Ok(None)
    }
}

fn table_has_column_tx(
    tx: &mut Transaction,
    table_name: &'static str,
    column_name: &str,
) -> ApiResult<bool> {
    validate_sqlite_identifier(table_name)?;
    let rows = db::tx_query(tx, &format!("PRAGMA table_info({table_name})"), &[])?;
    for row in rows {
        if let Some(Value::Text(name)) = row.get(1)
            && name == column_name
        {
            return Ok(true);
        }
    }
    Ok(false)
}

fn validate_sqlite_identifier(value: &str) -> ApiResult<()> {
    if !value.is_empty()
        && value
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '_')
    {
        Ok(())
    } else {
        Err(internal("Invalid SQLite identifier"))
    }
}

fn notification_template_agreement_from_row(
    row: &[Value],
) -> ApiResult<NotificationTemplateAgreementRecord> {
    Ok(NotificationTemplateAgreementRecord {
        id: db::text(&row[0], "notification_template_agreement_id")?,
        user_id: db::blob(&row[1], "user_id")?,
        template_code: db::text(&row[2], "template_code")?,
        status: db::text(&row[3], "status")?,
        source: db::text(&row[4], "source")?,
        last_result: db::nullable_text(&row[5])?,
        created_at: db::integer(&row[6], "created_at")?,
        updated_at: db::integer(&row[7], "updated_at")?,
    })
}

fn normalize_required_text(value: &str, field: &'static str) -> ApiResult<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(bad_request(
            "MISSING_REQUIRED_FIELD",
            format!("{field} is required"),
        ));
    }
    Ok(trimmed.to_string())
}

fn normalize_optional_text(value: &str, fallback: &str) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        fallback.to_string()
    } else {
        trimmed.to_string()
    }
}

fn normalize_optional_code(value: Option<String>) -> Option<String> {
    value
        .map(|code| code.trim().to_string())
        .filter(|code| !code.is_empty())
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

    #[test]
    fn serializes_notification_template_agreement_with_generic_template_code() {
        let record = NotificationTemplateAgreementRecord {
            id: "agreement-1".to_string(),
            user_id: vec![1, 2, 3],
            template_code: "poll-maker-poll-status-result".to_string(),
            status: "OPTED_IN".to_string(),
            source: APPS_IN_TOSS_NOTIFICATION_AGREEMENT_SDK_SOURCE.to_string(),
            last_result: Some("newAgreement".to_string()),
            created_at: 1,
            updated_at: 2,
        };

        let value = serde_json::to_value(record).unwrap();

        assert_eq!(value["templateCode"], "poll-maker-poll-status-result");
        assert!(value.get("agreementTemplateCode").is_none());
    }

    #[test]
    fn serializes_dispatch_gate_with_notification_template_code() {
        let gate = MessageDispatchGate {
            allowed: true,
            purpose: MessagePurpose::Functional,
            template_code: "poll-maker-poll-status-result".to_string(),
            requires_notification_agreement: true,
            notification_template_code: Some("poll-maker-poll-status-result".to_string()),
            skip_reason: None,
            template_status: Some("APPROVED".to_string()),
        };

        let value = serde_json::to_value(gate).unwrap();

        assert_eq!(
            value["notificationTemplateCode"],
            "poll-maker-poll-status-result"
        );
        assert_eq!(value["requiresNotificationAgreement"], true);
        assert!(value.get("agreementTemplateCode").is_none());
        assert!(value.get("requiresTemplateAgreement").is_none());
    }

    #[test]
    fn message_template_row_trims_notification_template_code() {
        let row = vec![
            Value::Text("FUNCTIONAL".to_string()),
            Value::Text("APPROVED".to_string()),
            Value::Integer(1),
            Value::Text(" poll-maker-poll-status-result ".to_string()),
        ];

        let template = message_template_from_row(&row).unwrap();

        assert_eq!(template.purpose, MessagePurpose::Functional);
        assert!(template.requires_agreement);
        assert_eq!(
            template.notification_template_code.as_deref(),
            Some("poll-maker-poll-status-result")
        );
    }

    #[test]
    fn message_template_row_drops_blank_notification_template_code() {
        let row = vec![
            Value::Text("FUNCTIONAL".to_string()),
            Value::Text("APPROVED".to_string()),
            Value::Integer(1),
            Value::Text("   ".to_string()),
        ];

        let template = message_template_from_row(&row).unwrap();

        assert!(template.requires_agreement);
        assert_eq!(template.notification_template_code, None);
    }

    #[test]
    fn legacy_message_template_row_uses_trimmed_template_code_when_agreement_is_required() {
        let row = vec![
            Value::Text("FUNCTIONAL".to_string()),
            Value::Text("APPROVED".to_string()),
            Value::Integer(1),
        ];

        let template =
            legacy_message_template_from_row(&row, " poll-maker-poll-status-result ").unwrap();

        assert!(template.requires_agreement);
        assert_eq!(
            template.notification_template_code.as_deref(),
            Some("poll-maker-poll-status-result")
        );
    }

    #[test]
    fn legacy_message_template_row_omits_notification_template_code_when_not_required() {
        let row = vec![
            Value::Text("FUNCTIONAL".to_string()),
            Value::Text("APPROVED".to_string()),
            Value::Integer(0),
        ];

        let template =
            legacy_message_template_from_row(&row, "poll-maker-poll-status-result").unwrap();

        assert!(!template.requires_agreement);
        assert_eq!(template.notification_template_code, None);
    }
}
