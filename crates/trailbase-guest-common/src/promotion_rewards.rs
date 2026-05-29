use serde::{Deserialize, Serialize};
use serde_json::{Map, Value as JsonValue};
use trailbase_wasm::db::{Transaction, Value};

use crate::promotion_campaigns::PromotionCampaignUsage;
use crate::responses::{ApiResult, bad_request, internal};
use crate::{db, read_string_path};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RewardAmountPolicy {
    Fixed {
        amount: i64,
    },
    Capped {
        requested_amount: i64,
        max_amount: i64,
    },
}

impl RewardAmountPolicy {
    pub fn amount(self) -> ApiResult<i64> {
        let amount = match self {
            RewardAmountPolicy::Fixed { amount } => amount,
            RewardAmountPolicy::Capped {
                requested_amount,
                max_amount,
            } => {
                if requested_amount <= 0 {
                    return Err(bad_request(
                        "INVALID_REWARD_AMOUNT",
                        "requested reward amount must be positive",
                    ));
                }
                if max_amount <= 0 {
                    return Err(bad_request(
                        "INVALID_REWARD_AMOUNT",
                        "max reward amount must be positive",
                    ));
                }
                requested_amount.min(max_amount)
            }
        };
        if amount <= 0 {
            return Err(bad_request(
                "INVALID_REWARD_AMOUNT",
                "reward amount must be positive",
            ));
        }
        Ok(amount)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromotionGrantContext {
    pub campaign_id: Option<String>,
    pub provider_promotion_code: Option<String>,
    pub reward_amount: i64,
    pub source: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct PromotionRewardPayloadInput<'a> {
    pub provider_request_id: &'a str,
    pub provider_transaction_key: Option<&'a str>,
    pub promotion: &'a PromotionGrantContext,
    pub requested_at: i64,
    pub toss_user_key: &'a str,
    pub eligibility_id: Option<&'a str>,
    pub user_id: Option<&'a str>,
    pub source_type: Option<&'a str>,
    pub source_id: Option<JsonValue>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromotionRewardOutcome {
    pub provider_request_id: String,
    pub provider_transaction_key: Option<String>,
    pub provider_status: String,
    pub provider_error_code: Option<String>,
    pub granted_at: Option<i64>,
    pub failed_at: Option<i64>,
    pub failure_reason: Option<String>,
    pub raw_response_json: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PromotionRewardUsageTable {
    pub table: &'static str,
    pub id_column: &'static str,
    pub campaign_id_column: &'static str,
    pub amount_column: &'static str,
    pub status_column: &'static str,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PromotionRewardFeatureUsageQuery<'a> {
    pub reward_table: PromotionRewardUsageTable,
    pub campaign_table: &'static str,
    pub campaign_table_id_column: &'static str,
    pub campaign_table_feature_key_column: &'static str,
    pub feature_key: &'a str,
    pub committed_statuses: &'a [&'a str],
    pub include_direct_campaign_id: bool,
}

pub fn promotion_reward_payload(input: PromotionRewardPayloadInput<'_>) -> JsonValue {
    let mut payload = Map::new();
    payload.insert(
        "amount".to_string(),
        JsonValue::from(input.promotion.reward_amount),
    );
    payload.insert(
        "providerRequestId".to_string(),
        JsonValue::from(input.provider_request_id),
    );
    payload.insert(
        "requestedAt".to_string(),
        JsonValue::from(input.requested_at),
    );
    payload.insert(
        "tossUserKey".to_string(),
        JsonValue::from(input.toss_user_key),
    );

    if let Some(value) = input.provider_transaction_key {
        payload.insert("providerTransactionKey".to_string(), JsonValue::from(value));
    }
    if let Some(value) = input.promotion.provider_promotion_code.as_deref() {
        payload.insert("promotionCode".to_string(), JsonValue::from(value));
    }
    if let Some(value) = input.promotion.campaign_id.as_deref() {
        payload.insert("promotionCampaignId".to_string(), JsonValue::from(value));
    }
    if !input.promotion.source.trim().is_empty() {
        payload.insert(
            "promotionSource".to_string(),
            JsonValue::from(input.promotion.source.as_str()),
        );
    }
    if let Some(value) = input.eligibility_id {
        payload.insert("eligibilityId".to_string(), JsonValue::from(value));
    }
    if let Some(value) = input.user_id {
        payload.insert("userId".to_string(), JsonValue::from(value));
    }
    if let Some(value) = input.source_type {
        payload.insert("sourceType".to_string(), JsonValue::from(value));
    }
    if let Some(value) = input.source_id {
        payload.insert("sourceId".to_string(), value);
    }

    JsonValue::Object(payload)
}

pub fn promotion_reward_outcome_from_response(
    response: &JsonValue,
    fallback_provider_request_id: &str,
    requested_at: Option<i64>,
) -> PromotionRewardOutcome {
    let provider_status = promotion_provider_status_from_response(response);
    let granted_at = if provider_status == "GRANTED" {
        read_integer_path(response, &["grantedAt", "data.grantedAt", "body.grantedAt"])
            .or(requested_at)
    } else {
        None
    };
    let failed_at = if provider_status == "FAILED" {
        requested_at
    } else {
        None
    };

    PromotionRewardOutcome {
        provider_request_id: read_string_path(
            response,
            &[
                "providerRequestId",
                "requestId",
                "data.providerRequestId",
                "body.providerRequestId",
            ],
        )
        .unwrap_or_else(|| fallback_provider_request_id.to_string()),
        provider_transaction_key: read_string_path(
            response,
            &[
                "providerTransactionKey",
                "transactionKey",
                "key",
                "success.key",
                "data.key",
                "data.providerTransactionKey",
                "body.providerTransactionKey",
            ],
        ),
        provider_status,
        provider_error_code: read_string_path(
            response,
            &["providerErrorCode", "errorCode", "code", "error.code"],
        ),
        granted_at,
        failed_at,
        failure_reason: read_string_path(response, &["failureReason", "message", "error"]),
        raw_response_json: serde_json::to_string(response).ok(),
    }
}

pub fn promotion_provider_status_from_response(response: &JsonValue) -> String {
    let status = read_string_path(
        response,
        &[
            "providerStatus",
            "status",
            "success.status",
            "data.status",
            "body.status",
            "body.providerStatus",
            "resultType",
            "body.resultType",
        ],
    );
    normalize_promotion_provider_status(
        response.get("ok").and_then(JsonValue::as_bool),
        status.as_deref(),
    )
}

pub fn normalize_promotion_provider_status(ok: Option<bool>, status: Option<&str>) -> String {
    if let Some(status) = status.map(str::trim).filter(|status| !status.is_empty()) {
        return match status.to_ascii_uppercase().as_str() {
            "SUCCESS" | "SUCCEEDED" | "GRANTED" | "DONE" | "COMPLETED" => "GRANTED".to_string(),
            "PENDING" | "WAITING" | "PROCESSING" | "REQUESTED" => "PENDING".to_string(),
            "FAILED" | "FAIL" | "ERROR" => "FAILED".to_string(),
            other => other.to_string(),
        };
    }

    match ok {
        Some(false) => "FAILED".to_string(),
        Some(true) => "GRANTED".to_string(),
        None => "PENDING".to_string(),
    }
}

pub fn promotion_ledger_status(provider_status: &str) -> &'static str {
    match normalize_promotion_provider_status(None, Some(provider_status)).as_str() {
        "GRANTED" => "success",
        "PENDING" => "pending",
        _ => "failed",
    }
}

pub fn promotion_reward_usage_for_campaign_tx(
    tx: &mut Transaction,
    table: PromotionRewardUsageTable,
    campaign_id: &str,
    committed_statuses: &[&str],
) -> ApiResult<PromotionCampaignUsage> {
    validate_usage_table(table)?;
    if committed_statuses.is_empty() {
        return Err(internal("committed statuses must not be empty"));
    }

    let status_placeholders = placeholders(2, committed_statuses.len());
    let sql = format!(
        "SELECT COALESCE(SUM(COALESCE({amount_column}, 0)), 0), COUNT(DISTINCT {id_column})
         FROM {table}
         WHERE {campaign_id_column} = ?1
           AND {status_column} IN ({status_placeholders})",
        amount_column = table.amount_column,
        id_column = table.id_column,
        table = table.table,
        campaign_id_column = table.campaign_id_column,
        status_column = table.status_column,
    );
    let mut params = Vec::with_capacity(1 + committed_statuses.len());
    params.push(Value::Text(campaign_id.to_string()));
    params.extend(
        committed_statuses
            .iter()
            .map(|status| Value::Text((*status).to_string())),
    );
    promotion_usage_from_query(tx, sql.as_str(), &params)
}

pub fn promotion_reward_usage_for_feature_tx(
    tx: &mut Transaction,
    query: PromotionRewardFeatureUsageQuery<'_>,
) -> ApiResult<PromotionCampaignUsage> {
    validate_usage_table(query.reward_table)?;
    validate_sql_identifier(query.campaign_table)?;
    validate_sql_identifier(query.campaign_table_id_column)?;
    validate_sql_identifier(query.campaign_table_feature_key_column)?;
    if query.committed_statuses.is_empty() {
        return Err(internal("committed statuses must not be empty"));
    }

    let first_status_index = if query.include_direct_campaign_id {
        2
    } else {
        1
    };
    let status_placeholders = placeholders(first_status_index + 1, query.committed_statuses.len());
    let direct_clause = if query.include_direct_campaign_id {
        format!(
            "{campaign_id_column} = ?1 OR ",
            campaign_id_column = query.reward_table.campaign_id_column
        )
    } else {
        String::new()
    };
    let feature_param = if query.include_direct_campaign_id {
        "?2"
    } else {
        "?1"
    };
    let sql = format!(
        "SELECT COALESCE(SUM(COALESCE({amount_column}, 0)), 0), COUNT(DISTINCT {id_column})
         FROM {reward_table}
         WHERE ({direct_clause}{campaign_id_column} IN (
             SELECT {campaign_table_id_column}
             FROM {campaign_table}
             WHERE {campaign_table_feature_key_column} = {feature_param}
           ))
           AND {status_column} IN ({status_placeholders})",
        amount_column = query.reward_table.amount_column,
        id_column = query.reward_table.id_column,
        reward_table = query.reward_table.table,
        direct_clause = direct_clause,
        campaign_id_column = query.reward_table.campaign_id_column,
        campaign_table_id_column = query.campaign_table_id_column,
        campaign_table = query.campaign_table,
        campaign_table_feature_key_column = query.campaign_table_feature_key_column,
        feature_param = feature_param,
        status_column = query.reward_table.status_column,
        status_placeholders = status_placeholders,
    );

    let mut params = Vec::with_capacity(
        usize::from(query.include_direct_campaign_id) + 1 + query.committed_statuses.len(),
    );
    if query.include_direct_campaign_id {
        params.push(Value::Text(query.feature_key.to_string()));
    }
    params.push(Value::Text(query.feature_key.to_string()));
    params.extend(
        query
            .committed_statuses
            .iter()
            .map(|status| Value::Text((*status).to_string())),
    );
    promotion_usage_from_query(tx, sql.as_str(), &params)
}

fn promotion_usage_from_query(
    tx: &mut Transaction,
    sql: &str,
    params: &[Value],
) -> ApiResult<PromotionCampaignUsage> {
    let rows = db::tx_query(tx, sql, params)?;
    Ok(PromotionCampaignUsage {
        committed_amount: db::integer(&rows[0][0], "promotion_committed_amount")?,
        committed_count: db::integer(&rows[0][1], "promotion_committed_count")?,
    })
}

fn placeholders(start_index: usize, count: usize) -> String {
    (start_index..start_index + count)
        .map(|index| format!("?{index}"))
        .collect::<Vec<_>>()
        .join(", ")
}

fn validate_usage_table(table: PromotionRewardUsageTable) -> ApiResult<()> {
    validate_sql_identifier(table.table)?;
    validate_sql_identifier(table.id_column)?;
    validate_sql_identifier(table.campaign_id_column)?;
    validate_sql_identifier(table.amount_column)?;
    validate_sql_identifier(table.status_column)?;
    Ok(())
}

fn validate_sql_identifier(identifier: &str) -> ApiResult<()> {
    let mut chars = identifier.chars();
    let Some(first) = chars.next() else {
        return Err(internal("SQL identifier must not be empty"));
    };
    if !(first == '_' || first.is_ascii_alphabetic()) {
        return Err(internal(format!("Invalid SQL identifier: {identifier}")));
    }
    if chars.all(|ch| ch == '_' || ch.is_ascii_alphanumeric()) {
        Ok(())
    } else {
        Err(internal(format!("Invalid SQL identifier: {identifier}")))
    }
}

fn read_integer_path(value: &JsonValue, paths: &[&str]) -> Option<i64> {
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
            if let Some(integer) = current.as_i64() {
                return Some(integer);
            }
            if let Some(text) = current.as_str()
                && let Ok(integer) = text.parse::<i64>()
            {
                return Some(integer);
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn fixed_amount_uses_configured_amount() {
        assert_eq!(
            RewardAmountPolicy::Fixed { amount: 10 }.amount().unwrap(),
            10
        );
    }

    #[test]
    fn capped_amount_clamps_to_max_amount() {
        assert_eq!(
            RewardAmountPolicy::Capped {
                requested_amount: 15,
                max_amount: 10,
            }
            .amount()
            .unwrap(),
            10
        );
    }

    #[test]
    fn capped_amount_uses_requested_amount_under_cap() {
        assert_eq!(
            RewardAmountPolicy::Capped {
                requested_amount: 7,
                max_amount: 10,
            }
            .amount()
            .unwrap(),
            7
        );
    }

    #[test]
    fn capped_amount_rejects_non_positive_inputs() {
        assert!(matches!(
            RewardAmountPolicy::Capped {
                requested_amount: 0,
                max_amount: 10,
            }
            .amount(),
            Err(err) if err.code == "INVALID_REWARD_AMOUNT"
        ));
        assert!(matches!(
            RewardAmountPolicy::Capped {
                requested_amount: 1,
                max_amount: 0,
            }
            .amount(),
            Err(err) if err.code == "INVALID_REWARD_AMOUNT"
        ));
    }

    #[test]
    fn provider_status_normalizes_common_values() {
        assert_eq!(
            promotion_provider_status_from_response(&json!({ "providerStatus": "SUCCESS" })),
            "GRANTED"
        );
        assert_eq!(
            promotion_provider_status_from_response(&json!({ "status": "REQUESTED" })),
            "PENDING"
        );
        assert_eq!(
            promotion_provider_status_from_response(&json!({ "status": "ERROR" })),
            "FAILED"
        );
        assert_eq!(
            promotion_provider_status_from_response(&json!({ "ok": false })),
            "FAILED"
        );
    }

    #[test]
    fn provider_outcome_preserves_response_fields() {
        let response = json!({
          "providerRequestId": "request-2",
          "providerTransactionKey": "transaction-1",
          "providerStatus": "GRANTED",
          "providerErrorCode": "4116",
          "grantedAt": 123,
          "message": "done",
        });
        let outcome = promotion_reward_outcome_from_response(&response, "request-1", Some(100));

        assert_eq!(outcome.provider_request_id, "request-2");
        assert_eq!(
            outcome.provider_transaction_key.as_deref(),
            Some("transaction-1")
        );
        assert_eq!(outcome.provider_status, "GRANTED");
        assert_eq!(outcome.provider_error_code.as_deref(), Some("4116"));
        assert_eq!(outcome.granted_at, Some(123));
        assert_eq!(outcome.failed_at, None);
        assert_eq!(outcome.failure_reason.as_deref(), Some("done"));
        assert!(outcome.raw_response_json.is_some());
    }

    #[test]
    fn provider_payload_omits_absent_optional_fields() {
        let context = PromotionGrantContext {
            campaign_id: Some("campaign-1".to_string()),
            provider_promotion_code: Some("promo".to_string()),
            reward_amount: 5,
            source: "database".to_string(),
        };
        let payload = promotion_reward_payload(PromotionRewardPayloadInput {
            provider_request_id: "request-1",
            provider_transaction_key: None,
            promotion: &context,
            requested_at: 100,
            toss_user_key: "toss-user",
            eligibility_id: Some("eligibility-1"),
            user_id: Some("user-1"),
            source_type: Some("mission_daily"),
            source_id: Some(json!("source-1")),
        });

        assert_eq!(payload["amount"], 5);
        assert_eq!(payload["promotionCode"], "promo");
        assert_eq!(payload["promotionCampaignId"], "campaign-1");
        assert_eq!(payload["promotionSource"], "database");
        assert_eq!(payload["eligibilityId"], "eligibility-1");
        assert_eq!(payload["sourceId"], "source-1");
        assert!(payload.get("providerTransactionKey").is_none());
    }

    #[test]
    fn ledger_status_maps_canonical_provider_status() {
        assert_eq!(promotion_ledger_status("GRANTED"), "success");
        assert_eq!(promotion_ledger_status("REQUESTED"), "pending");
        assert_eq!(promotion_ledger_status("ERROR"), "failed");
    }

    #[test]
    fn validates_sql_identifiers_for_adapter_queries() {
        assert!(validate_sql_identifier("reward_grants").is_ok());
        assert!(validate_sql_identifier("_reward_grants1").is_ok());
        assert!(validate_sql_identifier("reward grants").is_err());
        assert!(validate_sql_identifier("1reward_grants").is_err());
        assert!(validate_sql_identifier("reward_grants;DROP").is_err());
    }
}
