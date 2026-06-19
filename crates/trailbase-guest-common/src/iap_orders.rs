use serde::{Deserialize, Serialize};
use serde_json::{Value as JsonValue, json};

use crate::read_string_path;

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

pub fn iap_ledger_status_for_provider_status(provider_status: &str) -> IapLedgerStatus {
    match provider_status.trim().to_ascii_uppercase().as_str() {
        "PAYMENT_COMPLETED" => IapLedgerStatus::PendingGrant,
        "PURCHASED" => IapLedgerStatus::Granted,
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

    IapOrderStatus {
        failure_reason: read_string_path(
            response,
            &[
                "failureReason",
                "failure_reason",
                "message",
                "error",
                "reason",
            ],
        ),
        grant_required: ledger_status.grant_required(),
        ledger_status,
        ok,
        order_id: read_string_path(response, &["orderId", "order_id", "success.orderId"]),
        provider_status,
        reason: read_string_path(response, &["reason", "success.reason", "data.reason"]),
        sku: read_string_path(response, &["sku", "success.sku", "data.sku"]),
        status_determined_at: read_string_path(
            response,
            &[
                "statusDeterminedAt",
                "status_determined_at",
                "success.statusDeterminedAt",
                "data.statusDeterminedAt",
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
            iap_ledger_status_for_provider_status("PURCHASED"),
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
        assert!(status.grant_required);
        assert!(!status.terminal);
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
}
