//! Explicit per-feature controls. Read status stays available; missing/stale policy
//! blocks mutations. Authorize every handler and read policy in its transaction.
use crate::db;
use crate::responses::{ApiResult, forbidden, internal};
use serde::{Deserialize, Serialize};
use trailbase_wasm::db::{Transaction, Value};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum OperationFeature {
    Iap,
    Promotion,
    SmartMessage,
    AppReward,
}
impl OperationFeature {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Iap => "iap",
            Self::Promotion => "promotion",
            Self::SmartMessage => "smart-message",
            Self::AppReward => "app-reward",
        }
    }
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum OperationPhase {
    Entry,
    Dispatch,
    Settlement,
    Status,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationPolicy {
    pub feature: OperationFeature,
    pub revision: i64,
    pub allow_entry: bool,
    pub allow_dispatch: bool,
    pub allow_settlement: bool,
    pub updated_at: i64,
    pub expires_at: i64,
}

pub fn operation_allowed(
    policy: Option<&OperationPolicy>,
    feature: OperationFeature,
    phase: OperationPhase,
    now: i64,
) -> bool {
    if phase == OperationPhase::Status {
        return true;
    }
    let Some(policy) = policy else {
        return false;
    };
    if policy.feature != feature
        || policy.revision <= 0
        || policy.updated_at < 0
        || now < policy.updated_at
        || now >= policy.expires_at
    {
        return false;
    }
    match phase {
        OperationPhase::Entry => policy.allow_entry,
        OperationPhase::Dispatch => policy.allow_dispatch,
        OperationPhase::Settlement => policy.allow_settlement,
        OperationPhase::Status => true,
    }
}

pub(crate) const SELECT_POLICY: &str =
    "SELECT revision,allow_entry,allow_dispatch,allow_settlement,updated_at,expires_at
    FROM operation_policies WHERE feature=?1";

/// Must be called in the same transaction as a new entry, dispatch permit or local
/// settlement. A dispatch permit must commit before the external call; a pause
/// cannot revoke a permit already committed or cancel an in-flight request.
/// Status permits reads only; never classify retries, sends or grants as status.
pub fn require_operation_tx(
    tx: &mut Transaction,
    feature: OperationFeature,
    phase: OperationPhase,
    now: i64,
) -> ApiResult<()> {
    if phase == OperationPhase::Status {
        return Ok(());
    }
    let hold = crate::settings::string("KIT_OPERATIONS_HOLD");
    if operation_hold_active(hold.as_deref()) {
        return Err(forbidden(
            "OPERATION_PAUSED",
            "Operations are held by the server environment",
        ));
    }
    let rows = db::tx_query(tx, SELECT_POLICY, &[Value::Text(feature.as_str().into())])?;
    let policy = rows
        .first()
        .map(|row| parse_policy(row, feature))
        .transpose()?;
    if operation_allowed(policy.as_ref(), feature, phase, now) {
        Ok(())
    } else {
        Err(forbidden(
            "OPERATION_PAUSED",
            "This operation is paused or its policy is unavailable",
        ))
    }
}
/// An external restore hold overrides every database mutation policy. Unknown
/// configured values fail closed; absence preserves normal per-feature control.
pub fn operation_hold_active(value: Option<&str>) -> bool {
    !matches!(value, None | Some("0") | Some("false"))
}

fn parse_policy(row: &[Value], feature: OperationFeature) -> ApiResult<OperationPolicy> {
    if row.len() != 6 {
        return Err(internal("Unexpected operation policy row width"));
    }
    let flag = |value: &Value| match value {
        Value::Integer(0) => Ok(false),
        Value::Integer(1) => Ok(true),
        _ => Err(internal("Invalid operation policy flag")),
    };
    Ok(OperationPolicy {
        feature,
        revision: db::integer(&row[0], "revision")?,
        allow_entry: flag(&row[1])?,
        allow_dispatch: flag(&row[2])?,
        allow_settlement: flag(&row[3])?,
        updated_at: db::integer(&row[4], "updated_at")?,
        expires_at: db::integer(&row[5], "expires_at")?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn external_hold_cannot_be_reopened_by_restored_database_settings() {
        for value in ["1", "true", "TRUE", "invalid"] {
            assert!(operation_hold_active(Some(value)));
        }
        for value in [None, Some("0"), Some("false")] {
            assert!(!operation_hold_active(value));
        }
    }
    #[test]
    fn entry_dispatch_and_existing_settlement_are_separate() {
        let policy = OperationPolicy {
            feature: OperationFeature::Iap,
            revision: 2,
            allow_entry: false,
            allow_dispatch: false,
            allow_settlement: true,
            updated_at: 100,
            expires_at: 200,
        };
        assert!(!operation_allowed(
            Some(&policy),
            OperationFeature::Iap,
            OperationPhase::Entry,
            150
        ));
        assert!(!operation_allowed(
            Some(&policy),
            OperationFeature::Iap,
            OperationPhase::Dispatch,
            150
        ));
        assert!(operation_allowed(
            Some(&policy),
            OperationFeature::Iap,
            OperationPhase::Settlement,
            150
        ));
        assert!(!operation_allowed(
            Some(&policy),
            OperationFeature::Promotion,
            OperationPhase::Settlement,
            150
        ));
        for now in [99, 200, 300] {
            assert!(!operation_allowed(
                Some(&policy),
                OperationFeature::Iap,
                OperationPhase::Settlement,
                now
            ));
        }
        assert!(!operation_allowed(
            None,
            OperationFeature::Iap,
            OperationPhase::Entry,
            150
        ));
        assert!(operation_allowed(
            None,
            OperationFeature::Iap,
            OperationPhase::Status,
            150
        ));
    }
    #[test]
    fn sqlite_policy_is_private_explicit_and_revision_fenced() {
        let db = rusqlite::Connection::open_in_memory().unwrap();
        db.execute_batch(include_str!(
            "../../../templates/trailbase/sql/operation_policies.sql"
        ))
        .unwrap();
        db.execute(
            "INSERT INTO operation_policies VALUES ('iap',1,1,1,1,100,200)",
            [],
        )
        .unwrap();
        assert_eq!(db.execute("UPDATE operation_policies SET revision=2,allow_entry=0,allow_dispatch=0 WHERE feature='iap' AND revision=1", []).unwrap(), 1);
        assert_eq!(db.execute("UPDATE operation_policies SET revision=2,allow_entry=1 WHERE feature='iap' AND revision=1", []).unwrap(), 0);
        let rows = crate::sql_test_support::query(&db, SELECT_POLICY, &[Value::Text("iap".into())]);
        assert_eq!(rows[0][1], rusqlite::types::Value::Integer(0));
        assert!(
            db.execute("UPDATE operation_policies SET allow_entry=2", [])
                .is_err()
        );
    }
}
