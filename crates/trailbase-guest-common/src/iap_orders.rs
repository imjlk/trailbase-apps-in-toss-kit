use serde::{Deserialize, Serialize};
use serde_json::{Value as JsonValue, json};
use trailbase_wasm::db::{Transaction, Value};

use crate::db;
use crate::read_string_path;
use crate::responses::{ApiResult, bad_request, internal};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum IapLedgerStatus {
    Failed,
    Granted,
    NotFound,
    Pending,
    PendingGrant,
    Refunded,
    Unknown,
}

impl IapLedgerStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            IapLedgerStatus::Failed => "FAILED",
            IapLedgerStatus::Granted => "GRANTED",
            IapLedgerStatus::NotFound => "NOT_FOUND",
            IapLedgerStatus::Pending => "PENDING",
            IapLedgerStatus::PendingGrant => "PENDING_GRANT",
            IapLedgerStatus::Refunded => "REFUNDED",
            IapLedgerStatus::Unknown => "UNKNOWN",
        }
    }

    pub fn grant_required(self) -> bool {
        self == IapLedgerStatus::PendingGrant
    }

    pub fn terminal(self) -> bool {
        matches!(
            self,
            IapLedgerStatus::Failed
                | IapLedgerStatus::Granted
                | IapLedgerStatus::NotFound
                | IapLedgerStatus::Refunded
        )
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IapOrderStatus {
    pub failure_reason: Option<String>,
    pub grant_required: bool,
    pub ledger_status: IapLedgerStatus,
    pub ok: bool,
    pub order_id: Option<String>,
    pub provider_status: String,
    pub reason: Option<String>,
    pub sku: Option<String>,
    pub status_determined_at: Option<String>,
    pub terminal: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IdempotentIapGrantResponse<'a> {
    pub already_granted: bool,
    pub grant_id: Option<&'a str>,
    pub order_id: &'a str,
    pub sku: &'a str,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IdempotentIapRestoreResponse {
    pub already_granted_count: usize,
    pub failed_count: usize,
    pub restored_count: usize,
    pub total_count: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct IapOrdersTable {
    pub table: &'static str,
    pub order_id_column: &'static str,
    pub user_id_column: &'static str,
    pub toss_user_key_hmac_column: &'static str,
    pub product_id_column: &'static str,
    pub status_column: &'static str,
    pub provider_status_column: &'static str,
    pub provider_reason_column: &'static str,
    pub failure_reason_column: &'static str,
    pub provider_response_json_column: &'static str,
    pub status_determined_at_column: &'static str,
    pub grant_id_column: &'static str,
    pub grant_payload_json_column: &'static str,
    pub created_at_column: &'static str,
    pub updated_at_column: &'static str,
    pub granted_at_column: &'static str,
    pub completed_at_column: &'static str,
    pub refunded_at_column: &'static str,
    pub failed_at_column: &'static str,
}

pub const DEFAULT_IAP_ORDERS_TABLE: IapOrdersTable = IapOrdersTable {
    table: "iap_orders",
    order_id_column: "order_id",
    user_id_column: "user_id",
    toss_user_key_hmac_column: "toss_user_key_hmac",
    product_id_column: "product_id",
    status_column: "status",
    provider_status_column: "provider_status",
    provider_reason_column: "provider_reason",
    failure_reason_column: "failure_reason",
    provider_response_json_column: "provider_response_json",
    status_determined_at_column: "status_determined_at",
    grant_id_column: "grant_id",
    grant_payload_json_column: "grant_payload_json",
    created_at_column: "created_at",
    updated_at_column: "updated_at",
    granted_at_column: "granted_at",
    completed_at_column: "completed_at",
    refunded_at_column: "refunded_at",
    failed_at_column: "failed_at",
};

#[derive(Debug, Clone, PartialEq)]
pub struct IapOrderStatusUpsertInput<'a> {
    pub user: &'a [u8],
    pub toss_user_key_hmac: Option<&'a str>,
    pub order_id: &'a str,
    pub product_id: &'a str,
    pub status: &'a IapOrderStatus,
    pub raw_response_json: Option<&'a str>,
    pub now: i64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct IapOrderGrantInput<'a> {
    pub order_id: &'a str,
    pub grant_id: Option<&'a str>,
    pub grant_payload_json: Option<&'a str>,
    pub now: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IapOrderLedgerRecord {
    pub order_id: String,
    pub user_id: Vec<u8>,
    pub toss_user_key_hmac: Option<String>,
    pub product_id: String,
    pub status: IapLedgerStatus,
    pub provider_status: String,
    pub provider_reason: Option<String>,
    pub failure_reason: Option<String>,
    pub provider_response_json: Option<String>,
    pub status_determined_at: Option<String>,
    pub grant_id: Option<String>,
    pub grant_payload_json: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub granted_at: Option<i64>,
    pub completed_at: Option<i64>,
    pub refunded_at: Option<i64>,
    pub failed_at: Option<i64>,
}

pub fn iap_ledger_status_for_provider_status(provider_status: &str) -> IapLedgerStatus {
    match provider_status.trim().to_ascii_uppercase().as_str() {
        "PAYMENT_COMPLETED" | "PENDING_GRANT" => IapLedgerStatus::PendingGrant,
        "PURCHASED" | "GRANTED" | "ALREADY_GRANTED" | "COMPLETED" => IapLedgerStatus::Granted,
        "REFUNDED" => IapLedgerStatus::Refunded,
        "FAILED" | "ERROR" | "MINIAPP_MISMATCH" => IapLedgerStatus::Failed,
        "NOT_FOUND" => IapLedgerStatus::NotFound,
        "ORDER_IN_PROGRESS" | "PAYMENT_PENDING" | "PENDING" | "PROCESSING" => {
            IapLedgerStatus::Pending
        }
        "" => IapLedgerStatus::Unknown,
        _ => IapLedgerStatus::Unknown,
    }
}

pub fn upsert_iap_order_status_tx(
    tx: &mut Transaction,
    table: IapOrdersTable,
    input: IapOrderStatusUpsertInput<'_>,
) -> ApiResult<IapOrderLedgerRecord> {
    let record = normalize_iap_order_status_upsert_input(input)?;
    let (sql, params) = iap_order_status_upsert_statement(table, &record)?;
    let rows = db::tx_query(tx, &sql, &params)?;
    rows.first()
        .map(|row| iap_order_ledger_record_from_row(row))
        .transpose()?
        .ok_or_else(|| internal("IAP order row was not upserted"))
}

pub fn mark_iap_order_granted_tx(
    tx: &mut Transaction,
    table: IapOrdersTable,
    input: IapOrderGrantInput<'_>,
) -> ApiResult<IapOrderLedgerRecord> {
    let (sql, params) = iap_order_grant_statement(table, input)?;
    let rows = db::tx_query(tx, &sql, &params)?;
    rows.first()
        .map(|row| iap_order_ledger_record_from_row(row))
        .transpose()?
        .ok_or_else(|| internal("IAP order row was not found for grant"))
}

pub fn normalize_iap_order_status_response(response: &JsonValue) -> IapOrderStatus {
    let ok = response
        .get("ok")
        .and_then(JsonValue::as_bool)
        .unwrap_or(true);
    let provider_status = read_string_path(
        response,
        &[
            "providerStatus",
            "provider_status",
            "status",
            "success.status",
            "data.status",
            "result.status",
        ],
    )
    .unwrap_or_else(|| {
        if ok {
            "UNKNOWN".to_string()
        } else {
            "ERROR".to_string()
        }
    });
    let ledger_status = iap_ledger_status_for_provider_status(&provider_status);
    let failure_reason = if ledger_status == IapLedgerStatus::Failed {
        read_string_path(
            response,
            &[
                "failureReason",
                "failure_reason",
                "message",
                "error",
                "reason",
            ],
        )
    } else {
        read_string_path(
            response,
            &["failureReason", "failure_reason", "message", "error"],
        )
    };

    IapOrderStatus {
        failure_reason,
        grant_required: ledger_status.grant_required(),
        ledger_status,
        ok,
        order_id: read_string_path(
            response,
            &[
                "orderId",
                "order_id",
                "success.orderId",
                "success.order_id",
                "data.orderId",
                "data.order_id",
                "result.orderId",
                "result.order_id",
            ],
        ),
        provider_status,
        reason: read_string_path(
            response,
            &["reason", "success.reason", "data.reason", "result.reason"],
        ),
        sku: read_string_path(
            response,
            &[
                "sku",
                "success.sku",
                "data.sku",
                "result.sku",
                "result.productId",
                "result.product_id",
            ],
        ),
        status_determined_at: read_string_path(
            response,
            &[
                "statusDeterminedAt",
                "status_determined_at",
                "success.statusDeterminedAt",
                "data.statusDeterminedAt",
                "result.statusDeterminedAt",
            ],
        ),
        terminal: ledger_status.terminal(),
    }
}

pub fn idempotent_iap_grant_response(input: IdempotentIapGrantResponse<'_>) -> JsonValue {
    json!({
        "ok": true,
        "orderId": input.order_id,
        "sku": input.sku,
        "granted": true,
        "alreadyGranted": input.already_granted,
        "status": IapLedgerStatus::Granted.as_str(),
        "grantId": input.grant_id,
    })
}

pub fn idempotent_iap_restore_response(input: IdempotentIapRestoreResponse) -> JsonValue {
    json!({
        "ok": input.failed_count == 0,
        "totalCount": input.total_count,
        "restoredCount": input.restored_count,
        "alreadyGrantedCount": input.already_granted_count,
        "failedCount": input.failed_count,
    })
}

#[derive(Debug, Clone, PartialEq)]
struct NormalizedIapOrderStatusUpsert {
    user_id: Vec<u8>,
    toss_user_key_hmac: Option<String>,
    order_id: String,
    product_id: String,
    status: IapLedgerStatus,
    provider_status: String,
    provider_reason: Option<String>,
    failure_reason: Option<String>,
    provider_response_json: Option<String>,
    status_determined_at: Option<String>,
    now: i64,
}

fn normalize_iap_order_status_upsert_input(
    input: IapOrderStatusUpsertInput<'_>,
) -> ApiResult<NormalizedIapOrderStatusUpsert> {
    if input.user.is_empty() {
        return Err(bad_request(
            "INVALID_IAP_ORDER",
            "IAP order user must not be empty",
        ));
    }
    let product_id = normalize_required_text(
        input.status.sku.as_deref().unwrap_or(input.product_id),
        "productId",
    )?;
    Ok(NormalizedIapOrderStatusUpsert {
        user_id: input.user.to_vec(),
        toss_user_key_hmac: normalize_optional_text(input.toss_user_key_hmac),
        order_id: normalize_required_text(
            input.status.order_id.as_deref().unwrap_or(input.order_id),
            "orderId",
        )?,
        product_id,
        status: input.status.ledger_status,
        provider_status: normalize_required_text(&input.status.provider_status, "providerStatus")?,
        provider_reason: normalize_optional_text(input.status.reason.as_deref()),
        failure_reason: normalize_optional_text(input.status.failure_reason.as_deref()),
        provider_response_json: normalize_optional_text(input.raw_response_json),
        status_determined_at: normalize_optional_text(input.status.status_determined_at.as_deref()),
        now: input.now,
    })
}

fn iap_order_status_upsert_statement(
    table: IapOrdersTable,
    record: &NormalizedIapOrderStatusUpsert,
) -> ApiResult<(String, Vec<Value>)> {
    validate_iap_orders_table(table)?;
    Ok((
        format!(
            "INSERT INTO {table} (
               {order_id_column}, {user_id_column}, {toss_user_key_hmac_column},
               {product_id_column}, {status_column}, {provider_status_column},
               {provider_reason_column}, {failure_reason_column}, {provider_response_json_column},
               {status_determined_at_column}, {created_at_column}, {updated_at_column},
               {completed_at_column}, {refunded_at_column}, {failed_at_column}
             )
             VALUES (
               ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11,
               CASE WHEN ?5 IN ('GRANTED', 'PENDING_GRANT') THEN ?11 ELSE NULL END,
               CASE WHEN ?5 = 'REFUNDED' THEN ?11 ELSE NULL END,
               CASE WHEN ?5 IN ('FAILED', 'NOT_FOUND') THEN ?11 ELSE NULL END
             )
             ON CONFLICT({order_id_column}) DO UPDATE SET
               {user_id_column} = excluded.{user_id_column},
               {toss_user_key_hmac_column} = COALESCE(excluded.{toss_user_key_hmac_column}, {table}.{toss_user_key_hmac_column}),
               {product_id_column} = excluded.{product_id_column},
               {status_column} = CASE
                 WHEN {table}.{status_column} = 'GRANTED' AND excluded.{status_column} <> 'REFUNDED'
                 THEN {table}.{status_column}
                 ELSE excluded.{status_column}
               END,
               {provider_status_column} = excluded.{provider_status_column},
               {provider_reason_column} = excluded.{provider_reason_column},
               {failure_reason_column} = excluded.{failure_reason_column},
               {provider_response_json_column} = excluded.{provider_response_json_column},
               {status_determined_at_column} = excluded.{status_determined_at_column},
               {updated_at_column} = excluded.{updated_at_column},
               {completed_at_column} = COALESCE({table}.{completed_at_column}, excluded.{completed_at_column}),
               {refunded_at_column} = COALESCE(excluded.{refunded_at_column}, {table}.{refunded_at_column}),
               {failed_at_column} = COALESCE(excluded.{failed_at_column}, {table}.{failed_at_column})
             RETURNING {returning_columns}",
            table = table.table,
            order_id_column = table.order_id_column,
            user_id_column = table.user_id_column,
            toss_user_key_hmac_column = table.toss_user_key_hmac_column,
            product_id_column = table.product_id_column,
            status_column = table.status_column,
            provider_status_column = table.provider_status_column,
            provider_reason_column = table.provider_reason_column,
            failure_reason_column = table.failure_reason_column,
            provider_response_json_column = table.provider_response_json_column,
            status_determined_at_column = table.status_determined_at_column,
            created_at_column = table.created_at_column,
            updated_at_column = table.updated_at_column,
            completed_at_column = table.completed_at_column,
            refunded_at_column = table.refunded_at_column,
            failed_at_column = table.failed_at_column,
            returning_columns = iap_order_returning_columns(table),
        ),
        vec![
            Value::Text(record.order_id.clone()),
            Value::Blob(record.user_id.clone()),
            text_or_null(record.toss_user_key_hmac.as_deref()),
            Value::Text(record.product_id.clone()),
            Value::Text(record.status.as_str().to_string()),
            Value::Text(record.provider_status.clone()),
            text_or_null(record.provider_reason.as_deref()),
            text_or_null(record.failure_reason.as_deref()),
            text_or_null(record.provider_response_json.as_deref()),
            text_or_null(record.status_determined_at.as_deref()),
            Value::Integer(record.now),
        ],
    ))
}

fn iap_order_grant_statement(
    table: IapOrdersTable,
    input: IapOrderGrantInput<'_>,
) -> ApiResult<(String, Vec<Value>)> {
    validate_iap_orders_table(table)?;
    Ok((
        format!(
            "UPDATE {table}
             SET {status_column} = 'GRANTED',
                 {grant_id_column} = ?2,
                 {grant_payload_json_column} = ?3,
                 {granted_at_column} = COALESCE({granted_at_column}, ?4),
                 {completed_at_column} = COALESCE({completed_at_column}, ?4),
                 {updated_at_column} = ?4
             WHERE {order_id_column} = ?1
             RETURNING {returning_columns}",
            table = table.table,
            status_column = table.status_column,
            grant_id_column = table.grant_id_column,
            grant_payload_json_column = table.grant_payload_json_column,
            granted_at_column = table.granted_at_column,
            completed_at_column = table.completed_at_column,
            updated_at_column = table.updated_at_column,
            order_id_column = table.order_id_column,
            returning_columns = iap_order_returning_columns(table),
        ),
        vec![
            Value::Text(normalize_required_text(input.order_id, "orderId")?),
            text_or_null(input.grant_id),
            text_or_null(input.grant_payload_json),
            Value::Integer(input.now),
        ],
    ))
}

fn iap_order_returning_columns(table: IapOrdersTable) -> String {
    [
        table.order_id_column,
        table.user_id_column,
        table.toss_user_key_hmac_column,
        table.product_id_column,
        table.status_column,
        table.provider_status_column,
        table.provider_reason_column,
        table.failure_reason_column,
        table.provider_response_json_column,
        table.status_determined_at_column,
        table.grant_id_column,
        table.grant_payload_json_column,
        table.created_at_column,
        table.updated_at_column,
        table.granted_at_column,
        table.completed_at_column,
        table.refunded_at_column,
        table.failed_at_column,
    ]
    .join(", ")
}

fn iap_order_ledger_record_from_row(row: &[Value]) -> ApiResult<IapOrderLedgerRecord> {
    Ok(IapOrderLedgerRecord {
        order_id: db::text(&row[0], "iap_order_id")?,
        user_id: db::blob(&row[1], "iap_order_user_id")?,
        toss_user_key_hmac: db::nullable_text(&row[2])?,
        product_id: db::text(&row[3], "iap_order_product_id")?,
        status: iap_ledger_status_for_provider_status(&db::text(&row[4], "iap_order_status")?),
        provider_status: db::text(&row[5], "iap_order_provider_status")?,
        provider_reason: db::nullable_text(&row[6])?,
        failure_reason: db::nullable_text(&row[7])?,
        provider_response_json: db::nullable_text(&row[8])?,
        status_determined_at: db::nullable_text(&row[9])?,
        grant_id: db::nullable_text(&row[10])?,
        grant_payload_json: db::nullable_text(&row[11])?,
        created_at: db::integer(&row[12], "iap_order_created_at")?,
        updated_at: db::integer(&row[13], "iap_order_updated_at")?,
        granted_at: db::nullable_integer(&row[14])?,
        completed_at: db::nullable_integer(&row[15])?,
        refunded_at: db::nullable_integer(&row[16])?,
        failed_at: db::nullable_integer(&row[17])?,
    })
}

fn validate_iap_orders_table(table: IapOrdersTable) -> ApiResult<()> {
    for identifier in [
        table.table,
        table.order_id_column,
        table.user_id_column,
        table.toss_user_key_hmac_column,
        table.product_id_column,
        table.status_column,
        table.provider_status_column,
        table.provider_reason_column,
        table.failure_reason_column,
        table.provider_response_json_column,
        table.status_determined_at_column,
        table.grant_id_column,
        table.grant_payload_json_column,
        table.created_at_column,
        table.updated_at_column,
        table.granted_at_column,
        table.completed_at_column,
        table.refunded_at_column,
        table.failed_at_column,
    ] {
        validate_sql_identifier(identifier)?;
    }
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_provider_status_to_ledger_status() {
        assert_eq!(
            iap_ledger_status_for_provider_status("PAYMENT_COMPLETED"),
            IapLedgerStatus::PendingGrant
        );
        assert_eq!(
            iap_ledger_status_for_provider_status("PENDING_GRANT"),
            IapLedgerStatus::PendingGrant
        );
        assert_eq!(
            iap_ledger_status_for_provider_status("PURCHASED"),
            IapLedgerStatus::Granted
        );
        assert_eq!(
            iap_ledger_status_for_provider_status("GRANTED"),
            IapLedgerStatus::Granted
        );
        assert_eq!(
            iap_ledger_status_for_provider_status("REFUNDED"),
            IapLedgerStatus::Refunded
        );
        assert_eq!(
            iap_ledger_status_for_provider_status("FAILED"),
            IapLedgerStatus::Failed
        );
        assert_eq!(
            iap_ledger_status_for_provider_status("NOT_FOUND"),
            IapLedgerStatus::NotFound
        );
        assert_eq!(
            iap_ledger_status_for_provider_status(" purchased "),
            IapLedgerStatus::Granted
        );
        assert_eq!(
            iap_ledger_status_for_provider_status("payment_completed"),
            IapLedgerStatus::PendingGrant
        );
    }

    #[test]
    fn normalizes_proxy_iap_order_status_response() {
        let status = normalize_iap_order_status_response(&json!({
            "ok": true,
            "orderId": "order-1",
            "sku": "coins.100",
            "providerStatus": "PAYMENT_COMPLETED",
            "statusDeterminedAt": "2026-06-19T10:00:00",
            "reason": "paid"
        }));

        assert_eq!(status.order_id.as_deref(), Some("order-1"));
        assert_eq!(status.sku.as_deref(), Some("coins.100"));
        assert_eq!(status.ledger_status, IapLedgerStatus::PendingGrant);
        assert_eq!(status.failure_reason, None);
        assert_eq!(status.reason.as_deref(), Some("paid"));
        assert!(status.grant_required);
        assert!(!status.terminal);
    }

    #[test]
    fn reads_nested_order_ids_from_wrapped_status_responses() {
        let status = normalize_iap_order_status_response(&json!({
            "ok": true,
            "data": {
                "orderId": "order-1",
                "sku": "coins.100",
                "status": "PURCHASED"
            }
        }));

        assert_eq!(status.order_id.as_deref(), Some("order-1"));
        assert_eq!(status.ledger_status, IapLedgerStatus::Granted);
        assert!(status.terminal);
    }

    #[test]
    fn reads_result_wrapped_order_ids_and_skus() {
        let status = normalize_iap_order_status_response(&json!({
            "ok": true,
            "result": {
                "orderId": "order-1",
                "sku": "coins.100",
                "status": "PAYMENT_COMPLETED"
            }
        }));

        assert_eq!(status.order_id.as_deref(), Some("order-1"));
        assert_eq!(status.sku.as_deref(), Some("coins.100"));
        assert_eq!(status.ledger_status, IapLedgerStatus::PendingGrant);
        assert!(status.grant_required);
    }

    #[test]
    fn failed_proxy_response_defaults_to_failed_status() {
        let status = normalize_iap_order_status_response(&json!({
            "ok": false,
            "orderId": "order-1",
            "failureReason": "upstream failed"
        }));

        assert_eq!(status.provider_status, "ERROR");
        assert_eq!(status.ledger_status, IapLedgerStatus::Failed);
        assert_eq!(status.failure_reason.as_deref(), Some("upstream failed"));
        assert!(status.terminal);
    }

    #[test]
    fn builds_idempotent_grant_and_restore_responses() {
        assert_eq!(
            idempotent_iap_grant_response(IdempotentIapGrantResponse {
                already_granted: true,
                grant_id: Some("grant-1"),
                order_id: "order-1",
                sku: "coins.100",
            }),
            json!({
                "ok": true,
                "orderId": "order-1",
                "sku": "coins.100",
                "granted": true,
                "alreadyGranted": true,
                "status": "GRANTED",
                "grantId": "grant-1",
            })
        );

        assert_eq!(
            idempotent_iap_restore_response(IdempotentIapRestoreResponse {
                already_granted_count: 1,
                failed_count: 0,
                restored_count: 2,
                total_count: 3,
            }),
            json!({
                "ok": true,
                "totalCount": 3,
                "restoredCount": 2,
                "alreadyGrantedCount": 1,
                "failedCount": 0,
            })
        );
    }

    #[test]
    fn builds_iap_order_status_upsert_statement() {
        let status = normalize_iap_order_status_response(&json!({
            "ok": true,
            "orderId": " order-1 ",
            "sku": " coins.100 ",
            "providerStatus": "PAYMENT_COMPLETED",
            "statusDeterminedAt": "2026-06-20T10:00:00",
            "reason": "paid"
        }));
        let record = normalize_iap_order_status_upsert_input(IapOrderStatusUpsertInput {
            user: &[1, 2, 3],
            toss_user_key_hmac: Some(" hmac-1 "),
            order_id: "fallback-order",
            product_id: "fallback-product",
            status: &status,
            raw_response_json: Some("{\"ok\":true}"),
            now: 1000,
        })
        .unwrap();

        let (sql, params) =
            iap_order_status_upsert_statement(DEFAULT_IAP_ORDERS_TABLE, &record).unwrap();

        assert!(sql.contains("INSERT INTO iap_orders"));
        assert!(sql.contains("ON CONFLICT(order_id) DO UPDATE"));
        assert!(sql.contains("excluded.status <> 'REFUNDED'"));
        assert_eq!(params.len(), 11);
        assert_eq!(record.order_id, "order-1");
        assert_eq!(record.product_id, "coins.100");
        assert_eq!(record.status, IapLedgerStatus::PendingGrant);
    }

    #[test]
    fn builds_iap_order_grant_statement() {
        let (sql, params) = iap_order_grant_statement(
            DEFAULT_IAP_ORDERS_TABLE,
            IapOrderGrantInput {
                order_id: " order-1 ",
                grant_id: Some(" grant-1 "),
                grant_payload_json: Some("{\"amount\":100}"),
                now: 1000,
            },
        )
        .unwrap();

        assert!(sql.contains("UPDATE iap_orders"));
        assert!(sql.contains("SET status = 'GRANTED'"));
        assert_eq!(params.len(), 4);
    }

    #[test]
    fn rejects_invalid_iap_order_input() {
        let status = normalize_iap_order_status_response(&json!({
            "ok": true,
            "orderId": "order-1",
            "sku": "coins.100",
            "providerStatus": "PURCHASED"
        }));
        let error = normalize_iap_order_status_upsert_input(IapOrderStatusUpsertInput {
            user: &[],
            toss_user_key_hmac: None,
            order_id: "order-1",
            product_id: "coins.100",
            status: &status,
            raw_response_json: None,
            now: 1000,
        })
        .unwrap_err();

        assert_eq!(error.code, "INVALID_IAP_ORDER");
        assert!(validate_sql_identifier("iap_orders;drop").is_err());
    }
}
