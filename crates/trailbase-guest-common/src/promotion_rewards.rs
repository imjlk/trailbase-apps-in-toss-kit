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

pub const DEFAULT_PROMOTION_REWARD_USAGE_TABLE: PromotionRewardUsageTable =
    PromotionRewardUsageTable {
        table: "promotion_reward_ledger",
        id_column: "id",
        campaign_id_column: "campaign_id",
        amount_column: "reward_amount",
        status_column: "status",
    };

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PromotionRewardLedgerTable {
    pub table: &'static str,
    pub id_column: &'static str,
    pub user_id_column: &'static str,
    pub campaign_id_column: &'static str,
    pub source_type_column: &'static str,
    pub source_id_column: &'static str,
    pub amount_column: &'static str,
    pub status_column: &'static str,
    pub provider_column: &'static str,
    pub provider_request_id_column: &'static str,
    pub provider_status_column: &'static str,
    pub provider_error_code_column: &'static str,
    pub provider_transaction_key_column: &'static str,
    pub provider_response_json_column: &'static str,
    pub requested_at_column: &'static str,
    pub granted_at_column: &'static str,
    pub failed_at_column: &'static str,
    pub failure_reason_column: &'static str,
    pub created_at_column: &'static str,
    pub updated_at_column: &'static str,
}

pub const DEFAULT_PROMOTION_REWARD_LEDGER_TABLE: PromotionRewardLedgerTable =
    PromotionRewardLedgerTable {
        table: "promotion_reward_ledger",
        id_column: "id",
        user_id_column: "user_id",
        campaign_id_column: "campaign_id",
        source_type_column: "source_type",
        source_id_column: "source_id",
        amount_column: "reward_amount",
        status_column: "status",
        provider_column: "provider",
        provider_request_id_column: "provider_request_id",
        provider_status_column: "provider_status",
        provider_error_code_column: "provider_error_code",
        provider_transaction_key_column: "provider_transaction_key",
        provider_response_json_column: "provider_response_json",
        requested_at_column: "requested_at",
        granted_at_column: "granted_at",
        failed_at_column: "failed_at",
        failure_reason_column: "failure_reason",
        created_at_column: "created_at",
        updated_at_column: "updated_at",
    };

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PromotionRewardFeatureUsageQuery<'a> {
    pub reward_table: PromotionRewardUsageTable,
    pub campaign_table: &'static str,
    pub campaign_table_id_column: &'static str,
    pub campaign_table_feature_key_column: &'static str,
    pub feature_key: &'a str,
    pub committed_statuses: &'a [&'a str],
    pub direct_campaign_id: Option<&'a str>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct PromotionRewardLedgerInsert<'a> {
    pub id: Option<&'a str>,
    pub user: &'a [u8],
    pub campaign_id: Option<&'a str>,
    pub source_type: &'a str,
    pub source_id: Option<&'a str>,
    pub reward_amount: i64,
    pub provider: Option<&'a str>,
    pub provider_request_id: &'a str,
    pub requested_at: i64,
    pub now: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PromotionRewardLedgerRecord {
    pub id: String,
    pub user_id: Vec<u8>,
    pub campaign_id: Option<String>,
    pub source_type: String,
    pub source_id: Option<String>,
    pub reward_amount: i64,
    pub status: String,
    pub provider: String,
    pub provider_request_id: String,
    pub provider_status: Option<String>,
    pub provider_error_code: Option<String>,
    pub provider_transaction_key: Option<String>,
    pub provider_response_json: Option<String>,
    pub requested_at: i64,
    pub granted_at: Option<i64>,
    pub failed_at: Option<i64>,
    pub failure_reason: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PromotionRewardLedgerInsertResult {
    pub inserted: bool,
    pub record: PromotionRewardLedgerRecord,
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
    let ledger_status = promotion_ledger_status(&provider_status);
    let granted_at = if provider_status == "GRANTED" {
        read_integer_path(response, &["grantedAt", "data.grantedAt", "body.grantedAt"])
            .or(requested_at)
    } else {
        None
    };
    let failed_at = if ledger_status == "failed" {
        read_integer_path(response, &["failedAt", "data.failedAt", "body.failedAt"])
            .or(requested_at)
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

pub fn insert_promotion_reward_ledger_tx(
    tx: &mut Transaction,
    table: PromotionRewardLedgerTable,
    input: PromotionRewardLedgerInsert<'_>,
) -> ApiResult<PromotionRewardLedgerInsertResult> {
    let record = normalize_promotion_reward_ledger_insert(input)?;
    let (sql, params) = promotion_reward_ledger_insert_statement(table, &record)?;
    let rows = db::tx_query(tx, &sql, &params)?;
    if let Some(row) = rows.first() {
        return Ok(PromotionRewardLedgerInsertResult {
            inserted: true,
            record: promotion_reward_ledger_record_from_row(row)?,
        });
    }

    let record = load_promotion_reward_ledger_by_idempotency_context_tx(tx, table, &record)?;
    Ok(PromotionRewardLedgerInsertResult {
        inserted: false,
        record,
    })
}

pub fn apply_promotion_reward_outcome_tx(
    tx: &mut Transaction,
    table: PromotionRewardLedgerTable,
    ledger_id: &str,
    outcome: &PromotionRewardOutcome,
    now: i64,
) -> ApiResult<PromotionRewardLedgerRecord> {
    let (sql, params) = promotion_reward_ledger_outcome_statement(table, ledger_id, outcome, now)?;
    let rows = db::tx_query(tx, &sql, &params)?;
    rows.first()
        .map(|row| promotion_reward_ledger_record_from_row(row))
        .transpose()?
        .ok_or_else(|| internal("Promotion reward ledger row was not found"))
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

#[derive(Debug, Clone, PartialEq)]
struct NormalizedPromotionRewardLedgerInsert {
    id: Option<String>,
    user_id: Vec<u8>,
    campaign_id: Option<String>,
    source_type: String,
    source_id: Option<String>,
    reward_amount: i64,
    provider: String,
    provider_request_id: String,
    requested_at: i64,
    now: i64,
}

fn normalize_promotion_reward_ledger_insert(
    input: PromotionRewardLedgerInsert<'_>,
) -> ApiResult<NormalizedPromotionRewardLedgerInsert> {
    if input.user.is_empty() {
        return Err(bad_request(
            "INVALID_PROMOTION_REWARD_LEDGER",
            "promotion reward user must not be empty",
        ));
    }
    if input.reward_amount <= 0 {
        return Err(bad_request(
            "INVALID_PROMOTION_REWARD_LEDGER",
            "promotion reward amount must be positive",
        ));
    }
    Ok(NormalizedPromotionRewardLedgerInsert {
        id: normalize_optional_text(input.id),
        user_id: input.user.to_vec(),
        campaign_id: normalize_optional_text(input.campaign_id),
        source_type: normalize_required_text(input.source_type, "sourceType")?,
        source_id: normalize_optional_text(input.source_id),
        reward_amount: input.reward_amount,
        provider: normalize_optional_text(input.provider).unwrap_or_else(|| "TOSS".to_string()),
        provider_request_id: normalize_required_text(
            input.provider_request_id,
            "providerRequestId",
        )?,
        requested_at: input.requested_at,
        now: input.now,
    })
}

fn promotion_reward_ledger_insert_statement(
    table: PromotionRewardLedgerTable,
    record: &NormalizedPromotionRewardLedgerInsert,
) -> ApiResult<(String, Vec<Value>)> {
    validate_promotion_reward_ledger_table(table)?;
    Ok((
        format!(
            "INSERT INTO {table} (
               {id_column}, {user_id_column}, {campaign_id_column}, {source_type_column},
               {source_id_column}, {amount_column}, {status_column}, {provider_column},
               {provider_request_id_column}, {provider_status_column}, {requested_at_column},
               {created_at_column}, {updated_at_column}
             )
             VALUES (
               COALESCE(?1, lower(hex(randomblob(16)))), ?2, ?3, ?4, ?5, ?6, 'pending',
               ?7, ?8, 'PENDING', ?9, ?10, ?10
             )
             ON CONFLICT({provider_request_id_column}) DO NOTHING
             RETURNING {returning_columns}",
            table = table.table,
            id_column = table.id_column,
            user_id_column = table.user_id_column,
            campaign_id_column = table.campaign_id_column,
            source_type_column = table.source_type_column,
            source_id_column = table.source_id_column,
            amount_column = table.amount_column,
            status_column = table.status_column,
            provider_column = table.provider_column,
            provider_request_id_column = table.provider_request_id_column,
            provider_status_column = table.provider_status_column,
            requested_at_column = table.requested_at_column,
            created_at_column = table.created_at_column,
            updated_at_column = table.updated_at_column,
            returning_columns = promotion_reward_ledger_returning_columns(table),
        ),
        vec![
            text_or_null(record.id.as_deref()),
            Value::Blob(record.user_id.clone()),
            text_or_null(record.campaign_id.as_deref()),
            Value::Text(record.source_type.clone()),
            text_or_null(record.source_id.as_deref()),
            Value::Integer(record.reward_amount),
            Value::Text(record.provider.clone()),
            Value::Text(record.provider_request_id.clone()),
            Value::Integer(record.requested_at),
            Value::Integer(record.now),
        ],
    ))
}

fn promotion_reward_ledger_outcome_statement(
    table: PromotionRewardLedgerTable,
    ledger_id: &str,
    outcome: &PromotionRewardOutcome,
    now: i64,
) -> ApiResult<(String, Vec<Value>)> {
    validate_promotion_reward_ledger_table(table)?;
    let ledger_id = normalize_required_text(ledger_id, "ledgerId")?;
    let status = promotion_ledger_status(&outcome.provider_status);
    Ok((
        format!(
            "UPDATE {table}
             SET {status_column} = CASE
                   WHEN {status_column} = 'success' AND ?2 <> 'success' THEN {status_column}
                   ELSE ?2
                 END,
                 {provider_request_id_column} = CASE
                   WHEN {status_column} = 'success' AND ?2 <> 'success' THEN {provider_request_id_column}
                   ELSE ?3
                 END,
                 {provider_status_column} = CASE
                   WHEN {status_column} = 'success' AND ?2 <> 'success' THEN {provider_status_column}
                   ELSE ?4
                 END,
                 {provider_error_code_column} = CASE
                   WHEN {status_column} = 'success' AND ?2 <> 'success' THEN {provider_error_code_column}
                   ELSE ?5
                 END,
                 {provider_transaction_key_column} = CASE
                   WHEN {status_column} = 'success' AND ?2 <> 'success' THEN {provider_transaction_key_column}
                   ELSE COALESCE(?6, {provider_transaction_key_column})
                 END,
                 {provider_response_json_column} = CASE
                   WHEN {status_column} = 'success' AND ?2 <> 'success' THEN {provider_response_json_column}
                   ELSE ?7
                 END,
                 {granted_at_column} = CASE
                   WHEN {status_column} = 'success' AND ?2 <> 'success' THEN {granted_at_column}
                   WHEN ?2 = 'success' THEN COALESCE({granted_at_column}, ?8)
                   ELSE NULL
                 END,
                 {failed_at_column} = CASE
                   WHEN {status_column} = 'success' AND ?2 <> 'success' THEN {failed_at_column}
                   WHEN ?2 = 'failed' THEN COALESCE({failed_at_column}, ?9)
                   ELSE ?9
                 END,
                 {failure_reason_column} = CASE
                   WHEN {status_column} = 'success' AND ?2 <> 'success' THEN {failure_reason_column}
                   ELSE ?10
                 END,
                 {updated_at_column} = CASE
                   WHEN {status_column} = 'success' AND ?2 <> 'success' THEN {updated_at_column}
                   ELSE ?11
                 END
             WHERE {id_column} = ?1
             RETURNING {returning_columns}",
            table = table.table,
            status_column = table.status_column,
            provider_request_id_column = table.provider_request_id_column,
            provider_status_column = table.provider_status_column,
            provider_error_code_column = table.provider_error_code_column,
            provider_transaction_key_column = table.provider_transaction_key_column,
            provider_response_json_column = table.provider_response_json_column,
            granted_at_column = table.granted_at_column,
            failed_at_column = table.failed_at_column,
            failure_reason_column = table.failure_reason_column,
            updated_at_column = table.updated_at_column,
            id_column = table.id_column,
            returning_columns = promotion_reward_ledger_returning_columns(table),
        ),
        vec![
            Value::Text(ledger_id),
            Value::Text(status.to_string()),
            Value::Text(outcome.provider_request_id.clone()),
            Value::Text(outcome.provider_status.clone()),
            text_or_null(outcome.provider_error_code.as_deref()),
            text_or_null(outcome.provider_transaction_key.as_deref()),
            text_or_null(outcome.raw_response_json.as_deref()),
            integer_or_null(outcome.granted_at),
            integer_or_null(outcome.failed_at),
            text_or_null(outcome.failure_reason.as_deref()),
            Value::Integer(now),
        ],
    ))
}

fn load_promotion_reward_ledger_by_idempotency_context_tx(
    tx: &mut Transaction,
    table: PromotionRewardLedgerTable,
    record: &NormalizedPromotionRewardLedgerInsert,
) -> ApiResult<PromotionRewardLedgerRecord> {
    let (sql, params) = promotion_reward_ledger_idempotency_lookup_statement(table, record)?;
    let rows = db::tx_query(tx, &sql, &params)?;
    rows.first()
        .map(|row| promotion_reward_ledger_record_from_row(row))
        .transpose()?
        .ok_or_else(|| {
            bad_request(
                "PROMOTION_REWARD_IDEMPOTENCY_CONFLICT",
                "providerRequestId already belongs to another reward context",
            )
        })
}

fn promotion_reward_ledger_idempotency_lookup_statement(
    table: PromotionRewardLedgerTable,
    record: &NormalizedPromotionRewardLedgerInsert,
) -> ApiResult<(String, Vec<Value>)> {
    validate_promotion_reward_ledger_table(table)?;
    Ok((
        format!(
            "SELECT {returning_columns}
             FROM {table}
             WHERE {provider_request_id_column} = ?1
               AND {user_id_column} = ?2
               AND ({campaign_id_column} = ?3 OR ({campaign_id_column} IS NULL AND ?3 IS NULL))
               AND {source_type_column} = ?4
               AND ({source_id_column} = ?5 OR ({source_id_column} IS NULL AND ?5 IS NULL))
               AND {amount_column} = ?6
               AND {provider_column} = ?7
             LIMIT 1",
            returning_columns = promotion_reward_ledger_returning_columns(table),
            table = table.table,
            provider_request_id_column = table.provider_request_id_column,
            user_id_column = table.user_id_column,
            campaign_id_column = table.campaign_id_column,
            source_type_column = table.source_type_column,
            source_id_column = table.source_id_column,
            amount_column = table.amount_column,
            provider_column = table.provider_column,
        ),
        vec![
            Value::Text(record.provider_request_id.clone()),
            Value::Blob(record.user_id.clone()),
            text_or_null(record.campaign_id.as_deref()),
            Value::Text(record.source_type.clone()),
            text_or_null(record.source_id.as_deref()),
            Value::Integer(record.reward_amount),
            Value::Text(record.provider.clone()),
        ],
    ))
}

pub fn promotion_reward_usage_for_feature_tx(
    tx: &mut Transaction,
    query: PromotionRewardFeatureUsageQuery<'_>,
) -> ApiResult<PromotionCampaignUsage> {
    let (sql, params) = feature_usage_sql_and_params(query)?;
    promotion_usage_from_query(tx, sql.as_str(), &params)
}

fn feature_usage_sql_and_params(
    query: PromotionRewardFeatureUsageQuery<'_>,
) -> ApiResult<(String, Vec<Value>)> {
    validate_usage_table(query.reward_table)?;
    validate_sql_identifier(query.campaign_table)?;
    validate_sql_identifier(query.campaign_table_id_column)?;
    validate_sql_identifier(query.campaign_table_feature_key_column)?;
    if query.committed_statuses.is_empty() {
        return Err(internal("committed statuses must not be empty"));
    }

    let has_direct_campaign = query.direct_campaign_id.is_some();
    let first_status_index = if has_direct_campaign { 2 } else { 1 };
    let status_placeholders = placeholders(first_status_index + 1, query.committed_statuses.len());
    let direct_clause = if has_direct_campaign {
        format!(
            "{campaign_id_column} = ?1 OR ",
            campaign_id_column = query.reward_table.campaign_id_column
        )
    } else {
        String::new()
    };
    let feature_param = if has_direct_campaign { "?2" } else { "?1" };
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

    let mut params =
        Vec::with_capacity(usize::from(has_direct_campaign) + 1 + query.committed_statuses.len());
    if let Some(direct_campaign_id) = query.direct_campaign_id {
        params.push(Value::Text(direct_campaign_id.to_string()));
    }
    params.push(Value::Text(query.feature_key.to_string()));
    params.extend(
        query
            .committed_statuses
            .iter()
            .map(|status| Value::Text((*status).to_string())),
    );
    Ok((sql, params))
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

fn promotion_reward_ledger_returning_columns(table: PromotionRewardLedgerTable) -> String {
    [
        table.id_column,
        table.user_id_column,
        table.campaign_id_column,
        table.source_type_column,
        table.source_id_column,
        table.amount_column,
        table.status_column,
        table.provider_column,
        table.provider_request_id_column,
        table.provider_status_column,
        table.provider_error_code_column,
        table.provider_transaction_key_column,
        table.provider_response_json_column,
        table.requested_at_column,
        table.granted_at_column,
        table.failed_at_column,
        table.failure_reason_column,
        table.created_at_column,
        table.updated_at_column,
    ]
    .join(", ")
}

fn promotion_reward_ledger_record_from_row(
    row: &[Value],
) -> ApiResult<PromotionRewardLedgerRecord> {
    Ok(PromotionRewardLedgerRecord {
        id: db::text(&row[0], "promotion_reward_ledger_id")?,
        user_id: db::blob(&row[1], "promotion_reward_ledger_user_id")?,
        campaign_id: db::nullable_text(&row[2])?,
        source_type: db::text(&row[3], "promotion_reward_ledger_source_type")?,
        source_id: db::nullable_text(&row[4])?,
        reward_amount: db::integer(&row[5], "promotion_reward_ledger_reward_amount")?,
        status: db::text(&row[6], "promotion_reward_ledger_status")?,
        provider: db::text(&row[7], "promotion_reward_ledger_provider")?,
        provider_request_id: db::text(&row[8], "promotion_reward_ledger_provider_request_id")?,
        provider_status: db::nullable_text(&row[9])?,
        provider_error_code: db::nullable_text(&row[10])?,
        provider_transaction_key: db::nullable_text(&row[11])?,
        provider_response_json: db::nullable_text(&row[12])?,
        requested_at: db::integer(&row[13], "promotion_reward_ledger_requested_at")?,
        granted_at: db::nullable_integer(&row[14])?,
        failed_at: db::nullable_integer(&row[15])?,
        failure_reason: db::nullable_text(&row[16])?,
        created_at: db::integer(&row[17], "promotion_reward_ledger_created_at")?,
        updated_at: db::integer(&row[18], "promotion_reward_ledger_updated_at")?,
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

fn validate_promotion_reward_ledger_table(table: PromotionRewardLedgerTable) -> ApiResult<()> {
    validate_sql_identifier(table.table)?;
    validate_sql_identifier(table.id_column)?;
    validate_sql_identifier(table.user_id_column)?;
    validate_sql_identifier(table.campaign_id_column)?;
    validate_sql_identifier(table.source_type_column)?;
    validate_sql_identifier(table.source_id_column)?;
    validate_sql_identifier(table.amount_column)?;
    validate_sql_identifier(table.status_column)?;
    validate_sql_identifier(table.provider_column)?;
    validate_sql_identifier(table.provider_request_id_column)?;
    validate_sql_identifier(table.provider_status_column)?;
    validate_sql_identifier(table.provider_error_code_column)?;
    validate_sql_identifier(table.provider_transaction_key_column)?;
    validate_sql_identifier(table.provider_response_json_column)?;
    validate_sql_identifier(table.requested_at_column)?;
    validate_sql_identifier(table.granted_at_column)?;
    validate_sql_identifier(table.failed_at_column)?;
    validate_sql_identifier(table.failure_reason_column)?;
    validate_sql_identifier(table.created_at_column)?;
    validate_sql_identifier(table.updated_at_column)?;
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

fn normalize_required_text(value: &str, label: &'static str) -> ApiResult<String> {
    let value = value.trim();
    if value.is_empty() {
        return Err(bad_request(
            "MISSING_REQUIRED_FIELD",
            format!("{label} is required"),
        ));
    }
    Ok(value.to_string())
}

fn normalize_optional_text(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn text_or_null(value: Option<&str>) -> Value {
    normalize_optional_text(value)
        .map(Value::Text)
        .unwrap_or(Value::Null)
}

fn integer_or_null(value: Option<i64>) -> Value {
    value.map(Value::Integer).unwrap_or(Value::Null)
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
    fn provider_outcome_marks_failed_ledger_statuses_with_failed_at() {
        let explicit_failed_at = promotion_reward_outcome_from_response(
            &json!({
                "providerStatus": "PROMOTION_EXECUTE_FAILED",
                "data": { "failedAt": 321 },
            }),
            "request-1",
            Some(100),
        );
        assert_eq!(
            explicit_failed_at.provider_status,
            "PROMOTION_EXECUTE_FAILED"
        );
        assert_eq!(explicit_failed_at.granted_at, None);
        assert_eq!(explicit_failed_at.failed_at, Some(321));

        for status in ["MISSING_TOSS_USER_KEY", "UPSTREAM_REJECTED"] {
            let outcome = promotion_reward_outcome_from_response(
                &json!({ "providerStatus": status }),
                "request-1",
                Some(100),
            );

            assert_eq!(outcome.provider_status, status);
            assert_eq!(outcome.granted_at, None);
            assert_eq!(outcome.failed_at, Some(100));
        }
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

    #[test]
    fn builds_promotion_reward_ledger_insert_statement() {
        let record = normalize_promotion_reward_ledger_insert(PromotionRewardLedgerInsert {
            id: Some(" ledger-1 "),
            user: &[1, 2, 3],
            campaign_id: Some(" campaign-1 "),
            source_type: " attendance_daily ",
            source_id: Some(" 2026-06-20 "),
            reward_amount: 100,
            provider: None,
            provider_request_id: " request-1 ",
            requested_at: 1000,
            now: 1001,
        })
        .unwrap();

        let (sql, params) = promotion_reward_ledger_insert_statement(
            DEFAULT_PROMOTION_REWARD_LEDGER_TABLE,
            &record,
        )
        .unwrap();

        assert!(sql.contains("INSERT INTO promotion_reward_ledger"));
        assert!(sql.contains("ON CONFLICT(provider_request_id) DO NOTHING"));
        assert_eq!(params.len(), 10);
        assert_eq!(record.id.as_deref(), Some("ledger-1"));
        assert_eq!(record.provider, "TOSS");
        assert_eq!(record.source_type, "attendance_daily");
    }

    #[test]
    fn promotion_reward_idempotency_lookup_matches_caller_context() {
        let record = normalize_promotion_reward_ledger_insert(PromotionRewardLedgerInsert {
            id: None,
            user: &[1, 2, 3],
            campaign_id: Some("campaign-1"),
            source_type: "attendance_daily",
            source_id: Some("2026-06-20"),
            reward_amount: 100,
            provider: None,
            provider_request_id: "request-1",
            requested_at: 1000,
            now: 1001,
        })
        .unwrap();

        let (sql, params) = promotion_reward_ledger_idempotency_lookup_statement(
            DEFAULT_PROMOTION_REWARD_LEDGER_TABLE,
            &record,
        )
        .unwrap();

        assert!(sql.contains("WHERE provider_request_id = ?1"));
        assert!(sql.contains("AND user_id = ?2"));
        assert!(sql.contains("AND (campaign_id = ?3 OR (campaign_id IS NULL AND ?3 IS NULL))"));
        assert!(sql.contains("AND source_type = ?4"));
        assert!(sql.contains("AND (source_id = ?5 OR (source_id IS NULL AND ?5 IS NULL))"));
        assert!(sql.contains("AND reward_amount = ?6"));
        assert!(sql.contains("AND provider = ?7"));
        assert_eq!(params.len(), 7);
    }

    #[test]
    fn builds_promotion_reward_ledger_outcome_statement() {
        let outcome = promotion_reward_outcome_from_response(
            &json!({
              "ok": true,
              "providerRequestId": "request-1",
              "providerStatus": "GRANTED",
              "providerTransactionKey": "tx-1",
              "grantedAt": 1234
            }),
            "fallback",
            Some(1000),
        );

        let (sql, params) = promotion_reward_ledger_outcome_statement(
            DEFAULT_PROMOTION_REWARD_LEDGER_TABLE,
            "ledger-1",
            &outcome,
            1235,
        )
        .unwrap();

        assert!(sql.contains("UPDATE promotion_reward_ledger"));
        assert!(sql.contains("provider_transaction_key"));
        assert!(sql.contains("status = 'success' AND ?2 <> 'success'"));
        assert!(sql.contains("COALESCE(granted_at, ?8)"));
        assert_eq!(params.len(), 11);
        assert_eq!(outcome.provider_status, "GRANTED");
        assert_eq!(promotion_ledger_status(&outcome.provider_status), "success");
    }

    #[test]
    fn rejects_invalid_promotion_reward_ledger_input() {
        let error = normalize_promotion_reward_ledger_insert(PromotionRewardLedgerInsert {
            id: None,
            user: &[],
            campaign_id: None,
            source_type: "attendance_daily",
            source_id: None,
            reward_amount: 100,
            provider: None,
            provider_request_id: "request-1",
            requested_at: 1000,
            now: 1001,
        })
        .unwrap_err();
        assert_eq!(error.code, "INVALID_PROMOTION_REWARD_LEDGER");

        let error = normalize_promotion_reward_ledger_insert(PromotionRewardLedgerInsert {
            id: None,
            user: &[1],
            campaign_id: None,
            source_type: "attendance_daily",
            source_id: None,
            reward_amount: 0,
            provider: None,
            provider_request_id: "request-1",
            requested_at: 1000,
            now: 1001,
        })
        .unwrap_err();
        assert_eq!(error.code, "INVALID_PROMOTION_REWARD_LEDGER");
    }

    #[test]
    fn feature_usage_query_binds_direct_campaign_id_separately() {
        let (_sql, params) = feature_usage_sql_and_params(PromotionRewardFeatureUsageQuery {
            reward_table: PromotionRewardUsageTable {
                table: "promotion_reward_ledger",
                id_column: "id",
                campaign_id_column: "campaign_id",
                amount_column: "amount",
                status_column: "status",
            },
            campaign_table: "promotion_campaigns",
            campaign_table_id_column: "id",
            campaign_table_feature_key_column: "feature_key",
            feature_key: "attendance",
            committed_statuses: &["pending", "success"],
            direct_campaign_id: Some("env:attendance"),
        })
        .unwrap();

        assert!(matches!(&params[0], Value::Text(value) if value == "env:attendance"));
        assert!(matches!(&params[1], Value::Text(value) if value == "attendance"));
        assert!(matches!(&params[2], Value::Text(value) if value == "pending"));
        assert!(matches!(&params[3], Value::Text(value) if value == "success"));
    }
}
