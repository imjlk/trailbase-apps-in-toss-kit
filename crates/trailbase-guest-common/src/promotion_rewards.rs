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
    pub protocol_column: &'static str,
    pub execution_started_at_column: &'static str,
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
        protocol_column: "protocol",
        execution_started_at_column: "execution_started_at",
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
    pub protocol: Option<String>,
    pub execution_started_at: Option<i64>,
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
) -> PromotionRewardOutcome {
    let provider_status = promotion_provider_status_from_response(response);
    let ledger_status = promotion_ledger_status(&provider_status);
    // Provider-supplied timestamps only: the request time is not a grant or
    // failure time, and the status contract reports observation time as
    // checkedAt, which the caller records through updated_at.
    let granted_at = if provider_status == "GRANTED" {
        read_integer_path(response, &["grantedAt", "data.grantedAt", "body.grantedAt"])
    } else {
        None
    };
    let failed_at = if ledger_status == "failed" {
        read_integer_path(response, &["failedAt", "data.failedAt", "body.failedAt"])
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
            "result",
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
    let trimmed = status.map(str::trim).filter(|status| !status.is_empty());
    // An UNKNOWN outcome must survive an ok:false envelope: the execute call
    // may have reached the provider before the response was lost, so it is
    // neither a confirmed grant nor a confirmed failure. Resolve it through
    // the status lookup with the persisted transaction key.
    if trimmed.is_some_and(|status| status.eq_ignore_ascii_case("UNKNOWN")) {
        return "UNKNOWN".to_string();
    }
    // A failure envelope cannot authorize a grant through a contradictory status.
    if ok == Some(false) {
        return "FAILED".to_string();
    }
    if let Some(status) = trimmed {
        return match status.to_ascii_uppercase().as_str() {
            "SUCCESS" | "SUCCEEDED" | "GRANTED" | "DONE" | "COMPLETED" => "GRANTED".to_string(),
            "PENDING" | "SUBMITTED" | "WAITING" | "PROCESSING" | "REQUESTED" => {
                "PENDING".to_string()
            }
            "FAILED" | "FAIL" | "ERROR" => "FAILED".to_string(),
            other => other.to_string(),
        };
    }

    // ok alone never fabricates a grant: an envelope without an observable
    // status is an unconfirmed outcome (execute SUBMITTED-style responses
    // carry their verdict in `result`, which the status paths above read).
    match ok {
        Some(false) => "FAILED".to_string(),
        Some(true) | None => "PENDING".to_string(),
    }
}

pub fn promotion_ledger_status(provider_status: &str) -> &'static str {
    match normalize_promotion_provider_status(None, Some(provider_status)).as_str() {
        "GRANTED" => "success",
        // SUBMITTED (execute accepted, not yet confirmed) and UNKNOWN
        // (outcome undeterminable) are neither granted nor definitively
        // failed; they stay pending for explicit status reconciliation.
        // NOT_FOUND (provider error 4111: no grant record for the key) and
        // every other verdict classify as failed — no grant exists.
        "PENDING" | "SUBMITTED" | "UNKNOWN" => "pending",
        _ => "failed",
    }
}

pub fn insert_promotion_reward_ledger_tx(
    tx: &mut Transaction,
    table: PromotionRewardLedgerTable,
    input: PromotionRewardLedgerInsert<'_>,
) -> ApiResult<PromotionRewardLedgerInsertResult> {
    crate::operation_policy::enforce_configured_operation_tx(
        tx,
        crate::operation_policy::OperationFeature::Promotion,
        crate::operation_policy::OperationPhase::Entry,
    )?;
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
    if let Some(row) = rows.first() {
        return promotion_reward_ledger_record_from_row(row);
    }
    // Classify the miss: a row that exists but carries a different provider
    // request id must never absorb another request's outcome. Load failures
    // propagate instead of masquerading as a missing row.
    if let Some(record) = load_promotion_reward_ledger_by_id_tx(tx, table, ledger_id)?
        && record.provider_request_id != outcome.provider_request_id
    {
        return Err(bad_request(
            "PROMOTION_REWARD_REQUEST_MISMATCH",
            "provider request does not match the reward ledger row",
        ));
    }
    Err(internal("Promotion reward ledger row was not found"))
}

/// Persist the prepare-issued transaction key on a pending ledger row that
/// has not started executing, in its own committed transaction, BEFORE any
/// execute call. Only rows already stamped `protocol = 'three-step'`
/// (created by the v2 insert, which stamps them at creation) can store a
/// key: a keyless v2 row is genuinely never-executed because the v2 claim
/// requires a stored key on a three-step row. Legacy rows — keyed or not —
/// are never adopted: a legacy row that executed but crashed before the
/// caller persisted its key is keyless and indistinguishable from a
/// never-dispatched one, so adopting it could double-grant; settle legacy
/// rows through explicit reconciliation instead. An existing different key
/// is never overwritten, a restart reuses the stored key, and the store
/// never touches the execution-start marker or the provider outcome.
pub fn store_promotion_transaction_key_tx(
    tx: &mut Transaction,
    table: PromotionRewardLedgerTable,
    ledger_id: &str,
    provider_transaction_key: &str,
    now: i64,
) -> ApiResult<PromotionRewardLedgerRecord> {
    crate::operation_policy::enforce_configured_operation_tx(
        tx,
        crate::operation_policy::OperationFeature::Promotion,
        crate::operation_policy::OperationPhase::Dispatch,
    )?;
    let key = normalize_required_text(provider_transaction_key, "providerTransactionKey")?;
    let (sql, params) = promotion_reward_ledger_store_key_statement(
        table,
        normalize_required_text(ledger_id, "ledgerId")?,
        &key,
        now,
    )?;
    let rows = db::tx_query(tx, &sql, &params)?;
    if let Some(row) = rows.first() {
        return promotion_reward_ledger_record_from_row(row);
    }
    // Load failures propagate; a row that exists gets a typed conflict for
    // its actual state instead of a generic miss.
    if let Some(record) = load_promotion_reward_ledger_by_id_tx(tx, table, ledger_id)? {
        if record.provider_transaction_key.as_deref() != Some(key.as_str()) {
            return Err(bad_request(
                "PROMOTION_TRANSACTION_KEY_CONFLICT",
                "ledger row already holds a different provider transaction key",
            ));
        }
        // Same key, but the row is not in a key-storable state: execution
        // already started (the marker is set) or the outcome is terminal.
        return Err(bad_request(
            "PROMOTION_TRANSACTION_KEY_PHASE_CONFLICT",
            "ledger row is not waiting to store a provider transaction key",
        ));
    }
    Err(internal("Promotion reward ledger row was not found"))
}

/// Atomically claim the right to execute by recording the execution-start
/// marker, in its own committed transaction BEFORE the external execute
/// call. The marker is write-once: the second concurrent caller gets None
/// (another worker owns the execution), a restart after the claim gets
/// None (recovery goes through the status lookup), and a row whose outcome
/// is already recorded is never re-entered. Only a three-step row with a
/// stored key and no marker can be claimed. Returns the record whose
/// stored key the caller must execute with.
pub fn begin_promotion_reward_execute_tx(
    tx: &mut Transaction,
    table: PromotionRewardLedgerTable,
    ledger_id: &str,
    now: i64,
) -> ApiResult<Option<PromotionRewardLedgerRecord>> {
    crate::operation_policy::enforce_configured_operation_tx(
        tx,
        crate::operation_policy::OperationFeature::Promotion,
        crate::operation_policy::OperationPhase::Dispatch,
    )?;
    let (sql, params) = promotion_reward_ledger_begin_execute_statement(
        table,
        normalize_required_text(ledger_id, "ledgerId")?,
        now,
    )?;
    let rows = db::tx_query(tx, &sql, &params)?;
    rows.first()
        .map(|row| promotion_reward_ledger_record_from_row(row))
        .transpose()
}

/// Ledger rows of the three-step contract whose execution started before
/// `started_before` and whose outcome is still unsettled (pending,
/// including PENDING/SUBMITTED/UNKNOWN provider statuses). Recovery for
/// these rows is a status lookup with the stored key — never prepare,
/// never execute, never a new grant intent. Ordering rides on `updated_at`
/// (advanced by every applied status outcome) so each unsettled row is
/// re-checked in turn instead of the oldest permanently-UNKNOWN rows
/// starving everything behind them; the row id breaks timestamp ties.
pub fn promotion_reward_ledgers_awaiting_recovery_tx(
    tx: &mut Transaction,
    table: PromotionRewardLedgerTable,
    started_before: i64,
    limit: i64,
) -> ApiResult<Vec<PromotionRewardLedgerRecord>> {
    let (sql, params) = promotion_reward_ledger_recovery_statement(table, started_before, limit)?;
    let rows = db::tx_query(tx, &sql, &params)?;
    rows.iter()
        .map(|row| promotion_reward_ledger_record_from_row(row))
        .collect()
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
               {source_id_column}, {amount_column}, {status_column}, {protocol_column},
               {provider_column}, {provider_request_id_column}, {provider_status_column},
               {requested_at_column}, {created_at_column}, {updated_at_column}
             )
             VALUES (
               COALESCE(?1, lower(hex(randomblob(16)))), ?2, ?3, ?4, ?5, ?6, 'pending',
               'three-step', ?7, ?8, 'PENDING', ?9, ?10, ?10
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
            protocol_column = table.protocol_column,
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
    // Sticky-terminal guards: a confirmed success is never downgraded, and a
    // confirmed failure is never resurrected into pending limbo by a late
    // non-terminal outcome (UNKNOWN/SUBMITTED/PENDING) for the same request —
    // its failure diagnostics survive intact. A late GRANTED confirmation
    // still upgrades a failed row.
    Ok((
        format!(
            "UPDATE {table}
             SET {status_column} = CASE
                   WHEN {status_column} = 'success' AND ?2 <> 'success' THEN {status_column}
                   WHEN {status_column} = 'failed' AND ?2 = 'pending' THEN {status_column}
                   ELSE ?2
                 END,
                 {provider_request_id_column} = CASE
                   WHEN {status_column} = 'success' AND ?2 <> 'success' THEN {provider_request_id_column}
                   WHEN {status_column} = 'failed' AND ?2 = 'pending' THEN {provider_request_id_column}
                   ELSE ?3
                 END,
                 {provider_status_column} = CASE
                   WHEN {status_column} = 'success' AND ?2 <> 'success' THEN {provider_status_column}
                   WHEN {status_column} = 'failed' AND ?2 = 'pending' THEN {provider_status_column}
                   ELSE ?4
                 END,
                 {provider_error_code_column} = CASE
                   WHEN {status_column} = 'success' AND ?2 <> 'success' THEN {provider_error_code_column}
                   WHEN {status_column} = 'failed' AND ?2 = 'pending' THEN {provider_error_code_column}
                   ELSE ?5
                 END,
                 {provider_transaction_key_column} = CASE
                   WHEN {status_column} = 'success' AND ?2 <> 'success' THEN {provider_transaction_key_column}
                   WHEN ?6 IS NOT NULL AND {provider_transaction_key_column} IS NOT NULL
                        AND ?6 <> {provider_transaction_key_column}
                     THEN {provider_transaction_key_column}
                   ELSE COALESCE(?6, {provider_transaction_key_column})
                 END,
                 {provider_response_json_column} = CASE
                   WHEN {status_column} = 'success' AND ?2 <> 'success' THEN {provider_response_json_column}
                   WHEN {status_column} = 'failed' AND ?2 = 'pending' THEN {provider_response_json_column}
                   ELSE ?7
                 END,
                 {granted_at_column} = CASE
                   WHEN {status_column} = 'success' AND ?2 <> 'success' THEN {granted_at_column}
                   WHEN ?2 = 'success' THEN COALESCE({granted_at_column}, ?8)
                   ELSE NULL
                 END,
                 {failed_at_column} = CASE
                   WHEN {status_column} = 'success' AND ?2 <> 'success' THEN {failed_at_column}
                   WHEN {status_column} = 'failed' AND ?2 = 'pending' THEN {failed_at_column}
                   WHEN ?2 = 'failed' THEN COALESCE({failed_at_column}, ?9)
                   ELSE ?9
                 END,
                 {failure_reason_column} = CASE
                   WHEN {status_column} = 'success' AND ?2 <> 'success' THEN {failure_reason_column}
                   WHEN {status_column} = 'failed' AND ?2 = 'pending' THEN {failure_reason_column}
                   ELSE ?10
                 END,
                 {updated_at_column} = CASE
                   WHEN {status_column} = 'success' AND ?2 <> 'success' THEN {updated_at_column}
                   WHEN {status_column} = 'failed' AND ?2 = 'pending' THEN {updated_at_column}
                   ELSE ?11
                 END
             WHERE {id_column} = ?1
               AND {provider_request_id_column} = ?3
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

/// Store the transaction key on a pending row that has not started
/// executing and does not hold a different key, and mark the row as a
/// three-step record. Execution facts (`execution_started_at`) and the
/// provider outcome (`provider_status`) are NOT written here — a re-store
/// of the same key can never reset a row to a pre-execution state.
fn promotion_reward_ledger_store_key_statement(
    table: PromotionRewardLedgerTable,
    ledger_id: String,
    provider_transaction_key: &str,
    now: i64,
) -> ApiResult<(String, Vec<Value>)> {
    validate_promotion_reward_ledger_table(table)?;
    Ok((
        format!(
            "UPDATE {table}
             SET {provider_transaction_key_column} = ?2,
                 {protocol_column} = 'three-step',
                 {updated_at_column} = ?3
             WHERE {id_column} = ?1
               AND {status_column} = 'pending'
               AND {protocol_column} = 'three-step'
               AND {execution_started_at_column} IS NULL
               AND ({provider_transaction_key_column} IS NULL
                    OR {provider_transaction_key_column} = ?2)
             RETURNING {returning_columns}",
            table = table.table,
            provider_transaction_key_column = table.provider_transaction_key_column,
            protocol_column = table.protocol_column,
            updated_at_column = table.updated_at_column,
            id_column = table.id_column,
            status_column = table.status_column,
            execution_started_at_column = table.execution_started_at_column,
            returning_columns = promotion_reward_ledger_returning_columns(table),
        ),
        vec![
            Value::Text(ledger_id),
            Value::Text(provider_transaction_key.to_string()),
            Value::Integer(now),
        ],
    ))
}

/// Atomically record the execution start: a three-step row with a stored
/// key that has not started executing gets `execution_started_at`, in its
/// own committed transaction BEFORE the external execute call. The marker
/// is write-once — the WHERE clause makes a second claim (concurrent
/// worker, restart, or late retry) match zero rows — and nothing ever
/// clears it back to a pre-execution state. `provider_status` is not
/// touched: it stores provider outcomes only.
fn promotion_reward_ledger_begin_execute_statement(
    table: PromotionRewardLedgerTable,
    ledger_id: String,
    now: i64,
) -> ApiResult<(String, Vec<Value>)> {
    validate_promotion_reward_ledger_table(table)?;
    Ok((
        format!(
            "UPDATE {table}
             SET {execution_started_at_column} = ?2,
                 {updated_at_column} = ?2
             WHERE {id_column} = ?1
               AND {status_column} = 'pending'
               AND {protocol_column} = 'three-step'
               AND {provider_transaction_key_column} IS NOT NULL
               AND {execution_started_at_column} IS NULL
             RETURNING {returning_columns}",
            table = table.table,
            execution_started_at_column = table.execution_started_at_column,
            updated_at_column = table.updated_at_column,
            id_column = table.id_column,
            status_column = table.status_column,
            protocol_column = table.protocol_column,
            provider_transaction_key_column = table.provider_transaction_key_column,
            returning_columns = promotion_reward_ledger_returning_columns(table),
        ),
        vec![Value::Text(ledger_id), Value::Integer(now)],
    ))
}

/// The single recovery target set for the three-step contract: rows whose
/// execution started (persisted marker), that hold their stored key and
/// original context, and whose outcome is still unsettled (PENDING,
/// SUBMITTED, and UNKNOWN provider statuses all remain pending). Pre-
/// execution rows (`execution_started_at IS NULL`) and legacy rows
/// (`protocol IS NULL`) are never listed: recovery never issues a new
/// grant intent and never re-executes — callers drive it with the status
/// lookup only.
fn promotion_reward_ledger_recovery_statement(
    table: PromotionRewardLedgerTable,
    started_before: i64,
    limit: i64,
) -> ApiResult<(String, Vec<Value>)> {
    validate_promotion_reward_ledger_table(table)?;
    if limit <= 0 {
        return Err(bad_request(
            "INVALID_PROMOTION_RECOVERY_LIMIT",
            "promotion recovery limit must be positive",
        ));
    }
    Ok((
        format!(
            "SELECT {returning_columns}
             FROM {table}
             WHERE {protocol_column} = 'three-step'
               AND {status_column} = 'pending'
               AND {provider_transaction_key_column} IS NOT NULL
               AND {execution_started_at_column} IS NOT NULL
               AND {execution_started_at_column} < ?1
             ORDER BY {updated_at_column} ASC, {id_column} ASC
             LIMIT ?2",
            returning_columns = promotion_reward_ledger_returning_columns(table),
            table = table.table,
            protocol_column = table.protocol_column,
            status_column = table.status_column,
            provider_transaction_key_column = table.provider_transaction_key_column,
            execution_started_at_column = table.execution_started_at_column,
            updated_at_column = table.updated_at_column,
            id_column = table.id_column,
        ),
        vec![Value::Integer(started_before), Value::Integer(limit)],
    ))
}

fn load_promotion_reward_ledger_by_id_tx(
    tx: &mut Transaction,
    table: PromotionRewardLedgerTable,
    ledger_id: &str,
) -> ApiResult<Option<PromotionRewardLedgerRecord>> {
    validate_promotion_reward_ledger_table(table)?;
    let sql = format!(
        "SELECT {returning_columns}
         FROM {table}
         WHERE {id_column} = ?1
         LIMIT 1",
        returning_columns = promotion_reward_ledger_returning_columns(table),
        table = table.table,
        id_column = table.id_column,
    );
    let rows = db::tx_query(tx, &sql, &[Value::Text(ledger_id.to_string())])?;
    rows.first()
        .map(|row| promotion_reward_ledger_record_from_row(row))
        .transpose()
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
        table.protocol_column,
        table.execution_started_at_column,
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
        protocol: db::nullable_text(&row[7])?,
        execution_started_at: db::nullable_integer(&row[8])?,
        provider: db::text(&row[9], "promotion_reward_ledger_provider")?,
        provider_request_id: db::text(&row[10], "promotion_reward_ledger_provider_request_id")?,
        provider_status: db::nullable_text(&row[11])?,
        provider_error_code: db::nullable_text(&row[12])?,
        provider_transaction_key: db::nullable_text(&row[13])?,
        provider_response_json: db::nullable_text(&row[14])?,
        requested_at: db::integer(&row[15], "promotion_reward_ledger_requested_at")?,
        granted_at: db::nullable_integer(&row[16])?,
        failed_at: db::nullable_integer(&row[17])?,
        failure_reason: db::nullable_text(&row[18])?,
        created_at: db::integer(&row[19], "promotion_reward_ledger_created_at")?,
        updated_at: db::integer(&row[20], "promotion_reward_ledger_updated_at")?,
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
    validate_sql_identifier(table.protocol_column)?;
    validate_sql_identifier(table.execution_started_at_column)?;
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
        let outcome = promotion_reward_outcome_from_response(&response, "request-1");

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
        );
        assert_eq!(
            explicit_failed_at.provider_status,
            "PROMOTION_EXECUTE_FAILED"
        );
        assert_eq!(explicit_failed_at.granted_at, None);
        assert_eq!(explicit_failed_at.failed_at, Some(321));

        // Without a provider-supplied failedAt the outcome carries no
        // failure timestamp: the request time is not a failure time.
        for status in ["MISSING_TOSS_USER_KEY", "UPSTREAM_REJECTED"] {
            let outcome = promotion_reward_outcome_from_response(
                &json!({ "providerStatus": status }),
                "request-1",
            );

            assert_eq!(outcome.provider_status, status);
            assert_eq!(outcome.granted_at, None);
            assert_eq!(outcome.failed_at, None);
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

#[cfg(all(test, not(target_arch = "wasm32")))]
mod sql_tests {
    use super::*;
    use crate::sql_test_support::{database, execute, query};
    use serde_json::json;

    /// A legacy row as written by the removed grant flow: no protocol, no
    /// execution marker, provider fields only.
    fn insert_legacy_ledger(db: &rusqlite::Connection, id: &str) {
        execute(
            db,
            "INSERT INTO promotion_reward_ledger (
               id, user_id, campaign_id, source_type, source_id, reward_amount,
               status, provider, provider_request_id, provider_status,
               requested_at, created_at, updated_at
             )
             VALUES (?1, X'01', NULL, 'attendance_daily', '2026-09-17', 100,
               'pending', 'TOSS', ?2, 'PENDING', 100, 100, 100)",
            &[
                Value::Text(id.to_string()),
                Value::Text(format!("{id}-request")),
            ],
        );
    }

    /// A new-contract intent row, created through the insert statement that
    /// stamps `protocol = 'three-step'`.
    fn insert_three_step_ledger(db: &rusqlite::Connection, id: &str) {
        let record = normalize_promotion_reward_ledger_insert(PromotionRewardLedgerInsert {
            id: Some(id),
            user: &[1],
            campaign_id: None,
            source_type: "attendance_daily",
            source_id: Some("2026-09-17"),
            reward_amount: 100,
            provider: None,
            provider_request_id: &format!("{id}-request"),
            requested_at: 100,
            now: 100,
        })
        .unwrap();
        let (sql, params) = promotion_reward_ledger_insert_statement(
            DEFAULT_PROMOTION_REWARD_LEDGER_TABLE,
            &record,
        )
        .unwrap();
        assert_eq!(query(db, &sql, &params).len(), 1);
    }

    fn sql_text(value: &rusqlite::types::Value) -> Option<&str> {
        match value {
            rusqlite::types::Value::Text(v) => Some(v.as_str()),
            _ => None,
        }
    }

    #[derive(Debug, PartialEq, Eq)]
    struct RowColumns {
        status: String,
        provider_status: Option<String>,
        execution_started_at: Option<i64>,
        protocol: Option<String>,
        granted_at: Option<i64>,
        failed_at: Option<i64>,
    }

    fn row_columns(db: &rusqlite::Connection, id: &str) -> RowColumns {
        let rows = query(
            db,
            "SELECT status, provider_status, execution_started_at, protocol,
                    granted_at, failed_at
             FROM promotion_reward_ledger WHERE id = ?1",
            &[Value::Text(id.to_string())],
        );
        let integer = |value: &rusqlite::types::Value| match value {
            rusqlite::types::Value::Integer(v) => Some(*v),
            _ => None,
        };
        RowColumns {
            status: sql_text(&rows[0][0]).unwrap_or_default().to_string(),
            provider_status: sql_text(&rows[0][1]).map(str::to_string),
            execution_started_at: integer(&rows[0][2]),
            protocol: sql_text(&rows[0][3]).map(str::to_string),
            granted_at: integer(&rows[0][4]),
            failed_at: integer(&rows[0][5]),
        }
    }

    fn store_key(db: &rusqlite::Connection, id: &str, key: &str, now: i64) -> usize {
        let (sql, params) = promotion_reward_ledger_store_key_statement(
            DEFAULT_PROMOTION_REWARD_LEDGER_TABLE,
            id.to_string(),
            key,
            now,
        )
        .unwrap();
        query(db, &sql, &params).len()
    }

    fn begin_execute(db: &rusqlite::Connection, id: &str, now: i64) -> usize {
        let (sql, params) = promotion_reward_ledger_begin_execute_statement(
            DEFAULT_PROMOTION_REWARD_LEDGER_TABLE,
            id.to_string(),
            now,
        )
        .unwrap();
        query(db, &sql, &params).len()
    }

    fn apply_outcome(
        db: &rusqlite::Connection,
        id: &str,
        outcome: &PromotionRewardOutcome,
        now: i64,
    ) -> usize {
        let (sql, params) = promotion_reward_ledger_outcome_statement(
            DEFAULT_PROMOTION_REWARD_LEDGER_TABLE,
            id,
            outcome,
            now,
        )
        .unwrap();
        query(db, &sql, &params).len()
    }

    fn outcome(response: serde_json::Value, request_id: &str) -> PromotionRewardOutcome {
        promotion_reward_outcome_from_response(&response, request_id)
    }

    #[test]
    fn new_intents_are_stamped_three_step() {
        let db = database();
        insert_three_step_ledger(&db, "row");
        let columns = row_columns(&db, "row");
        assert_eq!(columns.protocol, Some("three-step".into()));
        assert_eq!(columns.execution_started_at, None);
        // A legacy row keeps its NULL protocol marker.
        insert_legacy_ledger(&db, "legacy");
        assert_eq!(row_columns(&db, "legacy").protocol, None);
    }

    #[test]
    fn stores_the_key_once_and_never_overwrites_a_different_key() {
        let db = database();
        insert_three_step_ledger(&db, "row");

        assert_eq!(store_key(&db, "row", "key-1", 200), 1);
        let columns = row_columns(&db, "row");
        assert_eq!(columns.protocol, Some("three-step".into()));
        assert_eq!(columns.execution_started_at, None);
        // Provider status is untouched by the key store.
        assert_eq!(columns.provider_status, Some("PENDING".into()));

        // Storing the same key again is idempotent (restart resumes with it).
        assert_eq!(store_key(&db, "row", "key-1", 210), 1);
        // A different key is rejected by the statement itself.
        assert_eq!(store_key(&db, "row", "key-2", 220), 0);
        let columns = row_columns(&db, "row");
        assert_eq!(columns.protocol, Some("three-step".into()));
    }

    #[test]
    fn key_store_failure_leaves_the_row_unexecutable() {
        // "store failed -> execute 0 times": the claim requires a stored key
        // under the three-step protocol, so a failed store never leads to an
        // executable row.
        let db = database();
        insert_three_step_ledger(&db, "row");
        // A conflicting second key cannot be stored...
        assert_eq!(store_key(&db, "row", "key-1", 200), 1);
        assert_eq!(store_key(&db, "row", "key-2", 210), 0);
        // ...and without the protocol marker a claim is impossible anyway.
        insert_three_step_ledger(&db, "bare");
        execute(
            &db,
            "UPDATE promotion_reward_ledger SET protocol = NULL WHERE id = 'bare'",
            &[],
        );
        assert_eq!(begin_execute(&db, "bare", 300), 0);
    }

    #[test]
    fn legacy_rows_with_a_stored_key_cannot_be_adopted_for_re_execution() {
        // A legacy row that already holds a key may have started executing
        // under the old flow (its execution facts are unknown), so a
        // same-key re-store must never re-flag it for a fresh claim.
        let db = database();
        insert_legacy_ledger(&db, "legacy-keyed");
        execute(
            &db,
            "UPDATE promotion_reward_ledger
             SET provider_transaction_key = 'legacy-key', provider_status = 'UNKNOWN'
             WHERE id = 'legacy-keyed'",
            &[],
        );
        assert_eq!(store_key(&db, "legacy-keyed", "legacy-key", 200), 0);
        assert_eq!(row_columns(&db, "legacy-keyed").protocol, None);
        assert_eq!(begin_execute(&db, "legacy-keyed", 300), 0);

        // Keyless legacy rows are equally unadoptable: a legacy grant that
        // executed but crashed before the caller persisted its key leaves
        // exactly this shape, and adopting it could double-grant.
        insert_legacy_ledger(&db, "legacy-bare");
        assert_eq!(store_key(&db, "legacy-bare", "fresh-key", 200), 0);
        assert_eq!(begin_execute(&db, "legacy-bare", 300), 0);
        assert_eq!(row_columns(&db, "legacy-bare").protocol, None);
    }

    #[test]
    fn only_one_worker_claims_the_execution() {
        let db = database();
        insert_three_step_ledger(&db, "row");
        store_key(&db, "row", "key-1", 200);

        assert_eq!(begin_execute(&db, "row", 300), 1);
        let columns = row_columns(&db, "row");
        assert_eq!(columns.execution_started_at, Some(300));
        // The provider outcome column stays untouched by the claim.
        assert_eq!(columns.provider_status, Some("PENDING".into()));
        // The concurrent worker, a restart, and a late retry all fail.
        assert_eq!(begin_execute(&db, "row", 310), 0);
        assert_eq!(begin_execute(&db, "row", 320), 0);
        // The marker never regresses.
        assert_eq!(row_columns(&db, "row").execution_started_at, Some(300));
    }

    #[test]
    fn unkeyed_or_terminal_rows_cannot_start_execution() {
        let db = database();
        insert_three_step_ledger(&db, "no-key");
        // Key not stored yet: prepare must run first.
        assert_eq!(begin_execute(&db, "no-key", 300), 0);

        insert_three_step_ledger(&db, "terminal");
        store_key(&db, "terminal", "key-1", 200);
        begin_execute(&db, "terminal", 300);
        apply_outcome(
            &db,
            "terminal",
            &outcome(
                json!({"ok": true, "providerStatus": "GRANTED", "grantedAt": 400}),
                "terminal-request",
            ),
            400,
        );
        // A granted row is never re-entered.
        assert_eq!(begin_execute(&db, "terminal", 500), 0);

        // Legacy rows are never adopted, keyed or not: a crashed legacy
        // grant can leave a keyless executed row that is indistinguishable
        // from a never-dispatched one. Only v2-created rows (stamped at
        // insert) can store keys and claim.
        insert_legacy_ledger(&db, "legacy");
        assert_eq!(begin_execute(&db, "legacy", 300), 0);
        assert_eq!(store_key(&db, "legacy", "key-l", 200), 0);
        assert_eq!(row_columns(&db, "legacy").protocol, None);
        assert_eq!(begin_execute(&db, "legacy", 310), 0);
    }

    #[test]
    fn started_rows_survive_pending_outcomes_and_same_key_restores() {
        // EXECUTING -> SUBMITTED/PENDING -> same-key re-store -> execute
        // re-request: all blocked from restarting the execution.
        let db = database();
        insert_three_step_ledger(&db, "row");
        store_key(&db, "row", "key-1", 200);
        assert_eq!(begin_execute(&db, "row", 300), 1);

        // A non-terminal execute outcome keeps the row pending and the
        // execution marker intact.
        for response in [
            json!({"ok": true, "result": "SUBMITTED", "providerTransactionKey": "key-1"}),
            json!({"ok": true, "status": "PENDING"}),
            json!({"ok": false, "providerStatus": "UNKNOWN", "providerTransactionKey": "key-1"}),
        ] {
            assert_eq!(
                apply_outcome(&db, "row", &outcome(response, "row-request"), 400),
                1
            );
            let columns = row_columns(&db, "row");
            assert_eq!(columns.status, "pending");
            assert_eq!(columns.execution_started_at, Some(300));

            // Re-storing the same key cannot reset the marker, and a new
            // claim is impossible.
            assert_eq!(store_key(&db, "row", "key-1", 410), 0);
            assert_eq!(begin_execute(&db, "row", 420), 0);
        }
    }

    #[test]
    fn recovery_list_targets_started_three_step_rows_only() {
        let db = database();
        insert_three_step_ledger(&db, "prepared");
        insert_three_step_ledger(&db, "started");
        insert_three_step_ledger(&db, "settled");
        insert_legacy_ledger(&db, "legacy-unknown");
        store_key(&db, "prepared", "key-p", 200);
        store_key(&db, "started", "key-s", 200);
        store_key(&db, "settled", "key-d", 200);
        begin_execute(&db, "started", 300);
        begin_execute(&db, "settled", 300);
        apply_outcome(
            &db,
            "settled",
            &outcome(json!({"ok": true, "status": "GRANTED"}), "settled-request"),
            400,
        );
        // A legacy row with an UNKNOWN provider outcome is NOT recovery
        // material: its execution facts are unknown and it is never
        // converted into a new-contract intent.
        execute(
            &db,
            "UPDATE promotion_reward_ledger SET provider_status = 'UNKNOWN' WHERE id = 'legacy-unknown'",
            &[],
        );

        let (sql, params) = promotion_reward_ledger_recovery_statement(
            DEFAULT_PROMOTION_REWARD_LEDGER_TABLE,
            350,
            10,
        )
        .unwrap();
        let rows = query(&db, &sql, &params);
        let ids: Vec<String> = rows
            .iter()
            .filter_map(|row| match &row[0] {
                rusqlite::types::Value::Text(value) => Some(value.clone()),
                _ => None,
            })
            .collect();
        assert_eq!(ids, ["started".to_string()]);

        // Staleness and ordering ride on the execution-start marker.
        let (sql, params) = promotion_reward_ledger_recovery_statement(
            DEFAULT_PROMOTION_REWARD_LEDGER_TABLE,
            250,
            10,
        )
        .unwrap();
        assert!(query(&db, &sql, &params).is_empty());
    }

    #[test]
    fn execute_outcomes_apply_only_to_the_matching_request() {
        let db = database();
        insert_three_step_ledger(&db, "row");
        store_key(&db, "row", "key-1", 200);
        begin_execute(&db, "row", 300);

        // Another request's response never lands on this ledger row.
        assert_eq!(
            apply_outcome(
                &db,
                "row",
                &outcome(
                    json!({"ok": true, "providerStatus": "GRANTED"}),
                    "other-request"
                ),
                400,
            ),
            0
        );
        assert_eq!(row_columns(&db, "row").status, "pending");

        // A matching request carrying a different transaction key applies
        // the outcome but never overwrites the stored key.
        assert_eq!(
            apply_outcome(
                &db,
                "row",
                &outcome(
                    json!({"ok": true, "providerStatus": "GRANTED", "grantedAt": 900, "providerTransactionKey": "key-other"}),
                    "row-request",
                ),
                400,
            ),
            1
        );
        let rows = query(
            &db,
            "SELECT provider_transaction_key FROM promotion_reward_ledger WHERE id = 'row'",
            &[],
        );
        let key = match &rows[0][0] {
            rusqlite::types::Value::Text(value) => value.clone(),
            _ => String::new(),
        };
        assert_eq!(key, "key-1");
        let columns = row_columns(&db, "row");
        assert_eq!(columns.status, "success");
        assert_eq!(columns.granted_at, Some(900));
        assert_eq!(columns.execution_started_at, Some(300));

        // A late PENDING response cannot revert the confirmed grant.
        assert_eq!(
            apply_outcome(
                &db,
                "row",
                &outcome(json!({"ok": true, "result": "SUBMITTED"}), "row-request"),
                500,
            ),
            1
        );
        assert_eq!(row_columns(&db, "row").status, "success");
    }

    #[test]
    fn submitted_and_unknown_execute_outcomes_stay_pending_without_timestamps() {
        let db = database();
        for (id, response, stored_provider_status) in [
            (
                "submitted",
                json!({"ok": true, "result": "SUBMITTED"}),
                // SUBMITTED normalizes onto the pending taxonomy.
                "PENDING",
            ),
            (
                "unknown",
                json!({"ok": false, "providerStatus": "UNKNOWN", "error": "INVALID_RESPONSE"}),
                "UNKNOWN",
            ),
        ] {
            insert_three_step_ledger(&db, id);
            store_key(&db, id, "key-1", 200);
            begin_execute(&db, id, 300);
            assert_eq!(
                apply_outcome(&db, id, &outcome(response, &format!("{id}-request")), 400),
                1
            );
            assert_eq!(
                row_columns(&db, id),
                RowColumns {
                    status: "pending".into(),
                    provider_status: Some(stored_provider_status.into()),
                    execution_started_at: Some(300),
                    protocol: Some("three-step".into()),
                    granted_at: None,
                    failed_at: None,
                }
            );
        }
    }

    #[test]
    fn ok_true_alone_never_fabricates_a_grant() {
        let parsed = promotion_reward_outcome_from_response(
            &json!({"ok": true, "providerTransactionKey": "key-1"}),
            "request-1",
        );
        assert_eq!(parsed.provider_status, "PENDING");
        assert_eq!(parsed.granted_at, None);
        assert_eq!(promotion_ledger_status(&parsed.provider_status), "pending");

        // Execute verdicts arrive in `result`.
        let submitted = promotion_reward_outcome_from_response(
            &json!({"ok": true, "result": "SUBMITTED"}),
            "r",
        );
        assert_eq!(submitted.provider_status, "PENDING");
        let unknown = promotion_reward_outcome_from_response(
            &json!({"ok": true, "result": "UNKNOWN", "failureReason": "transport"}),
            "r",
        );
        assert_eq!(unknown.provider_status, "UNKNOWN");
        assert_eq!(promotion_ledger_status(&unknown.provider_status), "pending");

        // Status lookups report NOT_FOUND when the provider has no record.
        let not_found = promotion_reward_outcome_from_response(
            &json!({"ok": true, "status": "NOT_FOUND"}),
            "r",
        );
        assert_eq!(not_found.provider_status, "NOT_FOUND");
        assert_eq!(promotion_ledger_status("NOT_FOUND"), "failed");
        assert_eq!(not_found.granted_at, None);
    }

    #[test]
    fn confirmed_failure_keeps_failure_diagnostics() {
        let db = database();
        insert_three_step_ledger(&db, "row");
        store_key(&db, "row", "key-1", 200);
        begin_execute(&db, "row", 300);
        assert_eq!(
            apply_outcome(
                &db,
                "row",
                &outcome(
                    json!({"ok": false, "providerStatus": "FAILED", "providerErrorCode": "4116", "failureReason": "budget exhausted", "failedAt": 350}),
                    "row-request",
                ),
                400,
            ),
            1
        );
        let columns = row_columns(&db, "row");
        assert_eq!(columns.status, "failed");
        // Only provider-supplied timestamps land; the request time never
        // masquerades as a failure time.
        assert_eq!(columns.failed_at, Some(350));
    }

    #[test]
    fn late_non_terminal_outcomes_cannot_resurrect_a_confirmed_failure() {
        let db = database();
        insert_three_step_ledger(&db, "row");
        store_key(&db, "row", "key-1", 200);
        begin_execute(&db, "row", 300);
        assert_eq!(
            apply_outcome(
                &db,
                "row",
                &outcome(
                    json!({"ok": false, "providerStatus": "FAILED", "providerErrorCode": "4116", "failureReason": "budget exhausted", "failedAt": 350}),
                    "row-request",
                ),
                400,
            ),
            1
        );

        for response in [
            json!({"ok": false, "providerStatus": "UNKNOWN", "providerTransactionKey": "key-1"}),
            json!({"ok": true, "result": "SUBMITTED"}),
        ] {
            assert_eq!(
                apply_outcome(&db, "row", &outcome(response, "row-request"), 500),
                1
            );
            assert_eq!(row_columns(&db, "row").status, "failed");
            assert_eq!(row_columns(&db, "row").failed_at, Some(350));
        }
        let rows = query(
            &db,
            "SELECT provider_error_code, failure_reason FROM promotion_reward_ledger WHERE id = 'row'",
            &[],
        );
        assert_eq!(sql_text(&rows[0][0]), Some("4116"));
        assert_eq!(sql_text(&rows[0][1]), Some("budget exhausted"));

        // A late GRANTED confirmation still upgrades the failed row.
        assert_eq!(
            apply_outcome(
                &db,
                "row",
                &outcome(
                    json!({"ok": true, "providerStatus": "GRANTED", "grantedAt": 900}),
                    "row-request",
                ),
                600,
            ),
            1
        );
        assert_eq!(row_columns(&db, "row").status, "success");
        assert_eq!(row_columns(&db, "row").granted_at, Some(900));
    }

    #[test]
    fn interrupted_migration_rolls_back_and_is_retryable() {
        // A failure mid-file (the second ALTER hits a pre-existing column)
        // must leave NO partial state behind: no half-added columns, no
        // backfilled rows — and a clean re-run must then succeed.
        let dir =
            std::env::temp_dir().join(format!("promotion-v2-atomicity-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let db_path = dir.join("ledger.db");
        let _ = std::fs::remove_file(&db_path);

        let v1_schema = "CREATE TABLE promotion_reward_ledger (
            id TEXT PRIMARY KEY,
            user_id BLOB NOT NULL,
            campaign_id TEXT,
            source_type TEXT NOT NULL,
            source_id TEXT,
            reward_amount INTEGER NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            provider TEXT NOT NULL DEFAULT 'TOSS',
            provider_request_id TEXT NOT NULL UNIQUE,
            provider_status TEXT,
            provider_error_code TEXT,
            provider_transaction_key TEXT,
            provider_response_json TEXT,
            requested_at INTEGER NOT NULL,
            granted_at INTEGER,
            failed_at INTEGER,
            failure_reason TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
          ) STRICT;";

        // Seed the v1 table with the column that will collide mid-file:
        // the first ALTER (protocol) succeeds inside the transaction, the
        // second (execution_started_at) fails, and everything rolls back.
        {
            let db = rusqlite::Connection::open(&db_path).unwrap();
            db.execute_batch(v1_schema).unwrap();
            db.execute_batch(
                "ALTER TABLE promotion_reward_ledger ADD COLUMN execution_started_at INTEGER;",
            )
            .unwrap();
            db.execute(
                "INSERT INTO promotion_reward_ledger (
                   id, user_id, source_type, reward_amount, status, provider,
                   provider_request_id, provider_status, provider_transaction_key,
                   requested_at, created_at, updated_at
                 ) VALUES ('prepared-1', X'01', 'attendance_daily', 5, 'pending', 'TOSS',
                   'prepared-1-request', 'PREPARED', 'key-1', 50, 50, 60)",
                [],
            )
            .unwrap();

            let result = db.execute_batch(include_str!(
                "../../../templates/trailbase/sql/promotion_reward_ledger.v2.sql"
            ));
            assert!(result.is_err(), "the colliding column must fail the batch");
            // Dropping the connection rolls the open transaction back.
        }

        // A fresh handle sees no partial state: the protocol column never
        // landed and the PREPARED row is untouched.
        {
            let db = rusqlite::Connection::open(&db_path).unwrap();
            let protocol_columns = db
                .query_row(
                    "SELECT COUNT(*) FROM pragma_table_info('promotion_reward_ledger')
                     WHERE name = 'protocol'",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap();
            assert_eq!(protocol_columns, 0);
            let provider_status = db
                .query_row(
                    "SELECT provider_status FROM promotion_reward_ledger WHERE id = 'prepared-1'",
                    [],
                    |row| row.get::<_, String>(0),
                )
                .unwrap();
            assert_eq!(provider_status, "PREPARED");

            // Remove the seeded collision and retry: the migration now
            // completes (schema only — no backfill exists to land).
            db.execute_batch(
                "ALTER TABLE promotion_reward_ledger DROP COLUMN execution_started_at;",
            )
            .unwrap();
            db.execute_batch(include_str!(
                "../../../templates/trailbase/sql/promotion_reward_ledger.v2.sql"
            ))
            .unwrap();
            // The retry lands the schema; with no backfill, the legacy
            // row stays unmarked and keeps its original provider_status.
            let row = db
                .query_row(
                    "SELECT protocol, provider_status FROM promotion_reward_ledger
                     WHERE id = 'prepared-1'",
                    [],
                    |row| Ok((row.get::<_, Option<String>>(0)?, row.get::<_, String>(1)?)),
                )
                .unwrap();
            assert_eq!(row, (None, "PREPARED".to_string()));
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn migration_nests_inside_a_runner_transaction() {
        // A migration runner that wraps each file in its own transaction
        // must be able to apply the savepoint-based migration without a
        // "cannot start a transaction within a transaction" failure, with
        // the runner's COMMIT persisting the result.
        // Build the v1 table shape (pre-v2 columns) directly.
        let db = rusqlite::Connection::open_in_memory().unwrap();
        db.execute_batch(
            "CREATE TABLE promotion_reward_ledger (
               id TEXT PRIMARY KEY,
               user_id BLOB NOT NULL,
               campaign_id TEXT,
               source_type TEXT NOT NULL,
               source_id TEXT,
               reward_amount INTEGER NOT NULL,
               status TEXT NOT NULL DEFAULT 'pending',
               provider TEXT NOT NULL DEFAULT 'TOSS',
               provider_request_id TEXT NOT NULL UNIQUE,
               provider_status TEXT,
               provider_error_code TEXT,
               provider_transaction_key TEXT,
               provider_response_json TEXT,
               requested_at INTEGER NOT NULL,
               granted_at INTEGER,
               failed_at INTEGER,
               failure_reason TEXT,
               created_at INTEGER NOT NULL,
               updated_at INTEGER NOT NULL
             ) STRICT;",
        )
        .unwrap();

        db.execute_batch("BEGIN").unwrap();
        db.execute_batch(include_str!(
            "../../../templates/trailbase/sql/promotion_reward_ledger.v2.sql"
        ))
        .unwrap();
        db.execute_batch("COMMIT").unwrap();

        let columns = db
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('promotion_reward_ledger')
                 WHERE name IN ('protocol', 'execution_started_at')",
                [],
                |row| row.get::<_, i64>(0),
            )
            .unwrap();
        assert_eq!(columns, 2);
    }

    #[test]
    fn unknown_survives_a_failure_envelope_in_the_parser() {
        let normalized = promotion_provider_status_from_response(&json!({
            "ok": false,
            "providerStatus": "UNKNOWN",
            "providerTransactionKey": "key-1"
        }));
        assert_eq!(normalized, "UNKNOWN");
        assert_eq!(promotion_ledger_status(&normalized), "pending");

        assert_eq!(promotion_ledger_status("SUBMITTED"), "pending");
        assert_eq!(promotion_ledger_status("GRANTED"), "success");
        assert_eq!(promotion_ledger_status("ERROR"), "failed");
        assert_eq!(promotion_ledger_status("NOT_FOUND"), "failed");

        let parsed = promotion_reward_outcome_from_response(
            &json!({"ok": false, "providerStatus": "UNKNOWN"}),
            "request-1",
        );
        assert_eq!(parsed.provider_status, "UNKNOWN");
        assert_eq!(parsed.granted_at, None);
        assert_eq!(parsed.failed_at, None);
    }

    #[test]
    fn migration_adds_execution_fact_columns_without_touching_legacy_rows() {
        // Simulate a v1 install: build the pre-v2 table shape, then apply the
        // explicit v2 migration file on top.
        let db = rusqlite::Connection::open_in_memory().unwrap();
        db.execute_batch("PRAGMA foreign_keys = ON; CREATE TABLE _user (id BLOB PRIMARY KEY) STRICT; INSERT INTO _user VALUES (X'01');").unwrap();
        db.execute_batch(
            "CREATE TABLE promotion_reward_ledger (
               id TEXT PRIMARY KEY,
               user_id BLOB NOT NULL REFERENCES _user(id) ON DELETE CASCADE,
               campaign_id TEXT,
               source_type TEXT NOT NULL,
               source_id TEXT,
               reward_amount INTEGER NOT NULL CHECK (reward_amount > 0),
               status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('recorded', 'pending', 'success', 'failed', 'cancelled')),
               provider TEXT NOT NULL DEFAULT 'TOSS' CHECK (length(trim(provider)) > 0),
               provider_request_id TEXT NOT NULL UNIQUE CHECK (length(trim(provider_request_id)) > 0),
               provider_status TEXT,
               provider_error_code TEXT,
               provider_transaction_key TEXT,
               provider_response_json TEXT CHECK (provider_response_json IS NULL OR json_valid(provider_response_json)),
               requested_at INTEGER NOT NULL,
               granted_at INTEGER,
               failed_at INTEGER,
               failure_reason TEXT,
               created_at INTEGER NOT NULL,
               updated_at INTEGER NOT NULL
             ) STRICT;",
        )
        .unwrap();
        // Every legacy row class — settled, PREPARED (key stored, claim
        // not provably never made: the 0.11 store fence admitted PENDING
        // too, so a store replay could re-mark an executed-then-PENDING
        // row), EXECUTING, unsettled outcome statuses, NULL, non-pending
        // PREPARED, and keyless PREPARED — stays unmarked and unclaimable.
        let mut expected: Vec<(String, &str, Option<String>, Option<&str>)> = vec![
            (
                "legacy-settled".to_string(),
                "success",
                Some("GRANTED".to_string()),
                Some("legacy-key"),
            ),
            (
                "legacy-prepared".to_string(),
                "pending",
                Some("PREPARED".to_string()),
                Some("legacy-key"),
            ),
        ];
        for provider_status in ["EXECUTING", "SUBMITTED", "UNKNOWN", "PENDING"] {
            expected.push((
                format!("legacy-inflight-{provider_status}"),
                "pending",
                Some(provider_status.to_string()),
                Some("legacy-key"),
            ));
        }
        expected.push((
            "legacy-inflight-null".to_string(),
            "pending",
            None,
            Some("legacy-key"),
        ));
        expected.push((
            "legacy-prepared-failed".to_string(),
            "failed",
            Some("PREPARED".to_string()),
            Some("legacy-key"),
        ));
        expected.push((
            "legacy-prepared-keyless".to_string(),
            "pending",
            Some("PREPARED".to_string()),
            None,
        ));
        let all_ids: Vec<String> = expected.iter().map(|(id, _, _, _)| id.clone()).collect();
        for (id, status, provider_status, key) in expected {
            db.execute(
                "INSERT INTO promotion_reward_ledger (
                   id, user_id, source_type, reward_amount, status, provider,
                   provider_request_id, provider_status, provider_transaction_key,
                   requested_at, created_at, updated_at
                 ) VALUES (?1, X'01', 'attendance_daily', 100, ?2, 'TOSS',
                   ?3, ?4, ?5, 50, 50, 60)",
                rusqlite::params![id, status, format!("{id}-request"), provider_status, key],
            )
            .unwrap();
        }

        db.execute_batch(include_str!(
            "../../../templates/trailbase/sql/promotion_reward_ledger.v2.sql"
        ))
        .unwrap();

        for id in &all_ids {
            let rows = query(
                &db,
                "SELECT protocol, execution_started_at, provider_transaction_key
                 FROM promotion_reward_ledger WHERE id = ?1",
                &[Value::Text(id.clone())],
            );
            assert!(matches!(rows[0][0], rusqlite::types::Value::Null), "{id}");
            assert!(matches!(rows[0][1], rusqlite::types::Value::Null), "{id}");
            let expected_key = if id.as_str() == "legacy-prepared-keyless" {
                None
            } else {
                Some("legacy-key")
            };
            assert_eq!(sql_text(&rows[0][2]), expected_key, "{id}");
            assert_eq!(begin_execute(&db, id, 300), 0, "{id}");
        }

        // The migrated schema serves the new statements: fresh installs and
        // upgraded installs run the same code paths.
        insert_three_step_ledger(&db, "fresh");
        assert_eq!(store_key(&db, "fresh", "key-2", 200), 1);
        assert_eq!(begin_execute(&db, "fresh", 300), 1);
    }
}
