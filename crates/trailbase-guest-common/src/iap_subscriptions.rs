//! Parse authenticated subscription webhooks and maintain a private per-order
//! entitlement projection. Authentication and provider-local timezone conversion
//! belong to the consumer ingress; this module must not be exposed directly.
use crate::{
    db,
    iap_orders::verified_iap_order_state_sql,
    responses::{ApiResult, bad_request, internal},
};
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use sha2::{Digest, Sha256};
use trailbase_wasm::db::{Transaction, Value};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SubscriptionStatus {
    Active,
    Expired,
    InGracePeriod,
    OnHold,
    Paused,
    Revoked,
}
impl SubscriptionStatus {
    fn as_str(&self) -> &'static str {
        match self {
            Self::Active => "ACTIVE",
            Self::Expired => "EXPIRED",
            Self::InGracePeriod => "IN_GRACE_PERIOD",
            Self::OnHold => "ON_HOLD",
            Self::Paused => "PAUSED",
            Self::Revoked => "REVOKED",
        }
    }
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubscriptionSnapshot {
    pub status: SubscriptionStatus,
    pub access_granted: bool,
    #[serde(deserialize_with = "deserialize_nullable_timestamp")]
    pub expires_at: Option<String>,
    pub auto_renew: bool,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SubscriptionChange {
    pub previous: Option<SubscriptionSnapshot>,
    pub current: SubscriptionSnapshot,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubscriptionStatusEvent {
    pub event_version: String,
    pub occurred_at: String,
    pub order_id: String,
    pub sku: String,
    pub change_reason: String,
    pub subscription: SubscriptionChange,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "eventType")]
pub enum SubscriptionWebhook {
    #[serde(rename = "callback.registration_verification")]
    RegistrationVerification {
        #[serde(rename = "occurredAt")]
        occurred_at: String,
    },
    #[serde(rename = "subscription.status_changed")]
    StatusChanged(SubscriptionStatusEvent),
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SubscriptionApplyOutcome {
    Applied,
    Duplicate,
    Stale,
    Conflict,
    UnmappedOrder,
}

pub fn parse_subscription_webhook(value: &JsonValue) -> ApiResult<SubscriptionWebhook> {
    // Registration callbacks currently omit the version. If one is supplied,
    // do not acknowledge a protocol the status-event handler cannot process.
    if value
        .get("eventVersion")
        .is_some_and(|v| v.as_str() != Some("1.0"))
    {
        return Err(bad_request(
            "INVALID_SUBSCRIPTION_WEBHOOK",
            "unsupported subscription webhook version",
        ));
    }
    let mut event: SubscriptionWebhook = serde_json::from_value(value.clone()).map_err(|_| {
        bad_request(
            "INVALID_SUBSCRIPTION_WEBHOOK",
            "subscription webhook shape is invalid",
        )
    })?;
    match &mut event {
        SubscriptionWebhook::RegistrationVerification { occurred_at } => {
            *occurred_at = normalize_provider_local_timestamp(occurred_at)?
        }
        SubscriptionWebhook::StatusChanged(event) => normalize_event(event)?,
    }
    Ok(event)
}

/// Requires a trusted consumer webhook ingress. Stores an unmapped event for
/// replay after the corresponding verified order exists; it never creates users,
/// grants inventory, or trusts a client-supplied SDK status as server authority.
pub fn apply_subscription_event_tx(
    tx: &mut Transaction,
    event: &SubscriptionStatusEvent,
    now: i64,
) -> ApiResult<SubscriptionApplyOutcome> {
    apply_event(tx, event, now)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SubscriptionEntitlement {
    pub order_id: String,
    pub sku: String,
    pub snapshot: SubscriptionSnapshot,
    pub occurred_at: String,
    pub needs_reconciliation: bool,
}

pub fn subscription_entitlement_for_user_tx(
    tx: &mut Transaction,
    order_id: &str,
    user: &[u8],
) -> ApiResult<Option<SubscriptionEntitlement>> {
    entitlement_for_user(tx, order_id, user)
}

fn entitlement_for_user(
    store: &mut impl Store,
    order_id: &str,
    user: &[u8],
) -> ApiResult<Option<SubscriptionEntitlement>> {
    let verified_order_state = verified_iap_order_state_sql();
    let rows = store.query(&format!("SELECT o.product_id,e.status,e.access_granted,e.expires_at,e.auto_renew,e.occurred_at,e.needs_reconciliation
        FROM iap_subscription_entitlements e JOIN (SELECT * FROM iap_orders WHERE {verified_order_state}) o ON o.order_id=e.order_id
        WHERE e.order_id=?1 AND o.user_id=?2"), &[Value::Text(order_id.into()),Value::Blob(user.to_vec())])?;
    rows.first()
        .map(|r| {
            Ok(SubscriptionEntitlement {
                order_id: order_id.into(),
                sku: db::text(&r[0], "product_id")?,
                snapshot: SubscriptionSnapshot {
                    status: serde_json::from_value(JsonValue::String(db::text(&r[1], "status")?))
                        .map_err(|_| internal("Invalid stored subscription status"))?,
                    access_granted: db::integer(&r[2], "access_granted")? != 0,
                    expires_at: db::nullable_text(&r[3])?,
                    auto_renew: db::integer(&r[4], "auto_renew")? != 0,
                },
                occurred_at: db::text(&r[5], "occurred_at")?,
                needs_reconciliation: db::integer(&r[6], "needs_reconciliation")? != 0,
            })
        })
        .transpose()
}

fn deserialize_nullable_timestamp<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<String>, D::Error> {
    Option::<String>::deserialize(deserializer)
}

trait Store {
    fn query(&mut self, sql: &str, params: &[Value]) -> ApiResult<Vec<Vec<Value>>>;
}
impl Store for Transaction {
    fn query(&mut self, sql: &str, params: &[Value]) -> ApiResult<Vec<Vec<Value>>> {
        db::tx_query(self, sql, params)
    }
}

fn apply_event(
    store: &mut impl Store,
    event: &SubscriptionStatusEvent,
    now: i64,
) -> ApiResult<SubscriptionApplyOutcome> {
    let mut event = event.clone();
    normalize_event(&mut event)?;
    let payload = serde_json::to_string(&event)
        .map_err(|_| internal("Subscription event serialization failed"))?;
    let event_id = hex::encode(Sha256::digest(payload.as_bytes()));
    let inserted = store.query("INSERT INTO iap_subscription_events (event_id,order_id,occurred_at,payload_json,received_at)
        VALUES (?1,?2,?3,?4,?5) ON CONFLICT(event_id) DO NOTHING RETURNING event_id",
        &[Value::Text(event_id.clone()),Value::Text(event.order_id.clone()),Value::Text(event.occurred_at.clone()),Value::Text(payload),Value::Integer(now)])?;
    if inserted.is_empty() {
        let rows = store.query(
            "SELECT disposition FROM iap_subscription_events WHERE event_id=?1",
            &[Value::Text(event_id.clone())],
        )?;
        if rows
            .first()
            .is_some_and(|r| matches!(&r[0],Value::Text(s) if s != "RECEIVED"))
        {
            return Ok(SubscriptionApplyOutcome::Duplicate);
        }
    }
    let verified_order_state = verified_iap_order_state_sql();
    let order = store.query(
        &format!("SELECT product_id FROM iap_orders WHERE order_id=?1 AND {verified_order_state}"),
        &[Value::Text(event.order_id.clone())],
    )?;
    let Some(order) = order.first() else {
        return Ok(SubscriptionApplyOutcome::UnmappedOrder);
    };
    if db::text(&order[0], "product_id")? != event.sku {
        return Err(bad_request(
            "SUBSCRIPTION_ORDER_MISMATCH",
            "subscription sku does not match the verified order",
        ));
    }
    let existing = store.query(
        "SELECT occurred_at,event_id FROM iap_subscription_entitlements WHERE order_id=?1",
        &[Value::Text(event.order_id.clone())],
    )?;
    let outcome = if let Some(row) = existing.first() {
        let previous_time = db::text(&row[0], "occurred_at")?;
        if previous_time > event.occurred_at {
            SubscriptionApplyOutcome::Stale
        } else if previous_time == event.occurred_at {
            store.query("UPDATE iap_subscription_entitlements SET needs_reconciliation=1,updated_at=?2 WHERE order_id=?1 RETURNING order_id", &[Value::Text(event.order_id.clone()),Value::Integer(now)])?;
            SubscriptionApplyOutcome::Conflict
        } else {
            SubscriptionApplyOutcome::Applied
        }
    } else {
        SubscriptionApplyOutcome::Applied
    };
    if outcome == SubscriptionApplyOutcome::Applied {
        let current = &event.subscription.current;
        store.query("INSERT INTO iap_subscription_entitlements
            (order_id,status,access_granted,expires_at,auto_renew,occurred_at,event_id,updated_at)
            VALUES (?1,?2,?3,?4,?5,?6,?7,?8)
            ON CONFLICT(order_id) DO UPDATE SET status=excluded.status,access_granted=excluded.access_granted,
              expires_at=excluded.expires_at,auto_renew=excluded.auto_renew,occurred_at=excluded.occurred_at,
              event_id=excluded.event_id,needs_reconciliation=0,updated_at=excluded.updated_at RETURNING order_id",
            &[Value::Text(event.order_id.clone()),Value::Text(current.status.as_str().into()),
              Value::Integer(i64::from(current.access_granted)),current.expires_at.as_ref().map(|s| Value::Text(s.clone())).unwrap_or(Value::Null),
              Value::Integer(i64::from(current.auto_renew)),Value::Text(event.occurred_at.clone()),Value::Text(event_id.clone()),Value::Integer(now)])?;
    }
    let disposition = match outcome {
        SubscriptionApplyOutcome::Applied => "APPLIED",
        SubscriptionApplyOutcome::Stale => "STALE",
        _ => "CONFLICT",
    };
    store.query(
        "UPDATE iap_subscription_events SET disposition=?2 WHERE event_id=?1 RETURNING event_id",
        &[Value::Text(event_id), Value::Text(disposition.into())],
    )?;
    Ok(outcome)
}

/// Compare using the same provider-local clock as the webhook timestamps. The
/// documentation omits a timezone: callers must explicitly configure conversion.
pub fn subscription_access_allowed(
    snapshot: &SubscriptionSnapshot,
    needs_reconciliation: bool,
    provider_local_now: &str,
) -> ApiResult<bool> {
    let now = normalize_provider_local_timestamp(provider_local_now)?;
    if needs_reconciliation
        || !snapshot.access_granted
        || !matches!(
            snapshot.status,
            SubscriptionStatus::Active | SubscriptionStatus::InGracePeriod
        )
    {
        return Ok(false);
    }
    // The webhook has no grace-period expiry field. Its paid-term expiresAt can
    // already be past while accessGranted remains authoritative during grace.
    if snapshot.status == SubscriptionStatus::InGracePeriod {
        return Ok(true);
    }
    Ok(match snapshot.expires_at.as_deref() {
        Some(expires) => normalize_provider_local_timestamp(expires)? > now,
        None => true,
    })
}

fn normalize_event(event: &mut SubscriptionStatusEvent) -> ApiResult<()> {
    if event.event_version != "1.0"
        || [&event.order_id, &event.sku, &event.change_reason]
            .iter()
            .any(|s| s.trim().is_empty())
    {
        return Err(bad_request(
            "INVALID_SUBSCRIPTION_EVENT",
            "unsupported event version or missing order fields",
        ));
    }
    event.occurred_at = normalize_provider_local_timestamp(&event.occurred_at)?;
    if let Some(expires) = &mut event.subscription.current.expires_at {
        *expires = normalize_provider_local_timestamp(expires)?;
    }
    if let Some(previous) = &mut event.subscription.previous
        && let Some(expires) = &mut previous.expires_at
    {
        *expires = normalize_provider_local_timestamp(expires)?;
    }
    Ok(())
}

/// Canonicalize timezone-less ISO timestamps so lexical ordering is stable even
/// when retries include different fractional-second precision. Reject offsets.
pub fn normalize_provider_local_timestamp(value: &str) -> ApiResult<String> {
    let invalid = || {
        bad_request(
            "INVALID_PROVIDER_TIMESTAMP",
            "expected a timezone-less ISO-8601 provider timestamp",
        )
    };
    let bytes = value.as_bytes();
    if bytes.len() < 19
        || !value.is_ascii()
        || [4, 7, 10, 13, 16]
            .iter()
            .zip([b'-', b'-', b'T', b':', b':'])
            .any(|(i, c)| bytes[*i] != c)
    {
        return Err(invalid());
    }
    for (i, b) in bytes[..19].iter().enumerate() {
        if ![4, 7, 10, 13, 16].contains(&i) && !b.is_ascii_digit() {
            return Err(invalid());
        }
    }
    let number = |a: usize, b: usize| value[a..b].parse::<u32>().map_err(|_| invalid());
    let (year, month, day) = (number(0, 4)?, number(5, 7)?, number(8, 10)?);
    let leap = year.is_multiple_of(4) && (!year.is_multiple_of(100) || year.is_multiple_of(400));
    let max_day = match month {
        4 | 6 | 9 | 11 => 30,
        2 => {
            if leap {
                29
            } else {
                28
            }
        }
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        _ => 0,
    };
    if year == 0
        || day == 0
        || day > max_day
        || number(11, 13)? > 23
        || number(14, 16)? > 59
        || number(17, 19)? > 59
    {
        return Err(invalid());
    }
    let fraction = if bytes.len() == 19 {
        ""
    } else {
        if bytes[19] != b'.'
            || bytes.len() < 21
            || bytes.len() > 29
            || !bytes[20..].iter().all(u8::is_ascii_digit)
        {
            return Err(invalid());
        }
        &value[20..]
    };
    Ok(format!("{}.{fraction:0<9}", &value[..19]))
}

#[cfg(all(test, not(target_arch = "wasm32")))]
mod tests {
    use super::*;
    use crate::sql_test_support;
    use rusqlite::types::Value as SqlValue;
    use serde_json::json;
    impl Store for rusqlite::Connection {
        fn query(&mut self, sql: &str, params: &[Value]) -> ApiResult<Vec<Vec<Value>>> {
            Ok(sql_test_support::query(self, sql, params)
                .into_iter()
                .map(|row| {
                    row.into_iter()
                        .map(|v| match v {
                            SqlValue::Null => Value::Null,
                            SqlValue::Integer(v) => Value::Integer(v),
                            SqlValue::Real(v) => Value::Real(v),
                            SqlValue::Text(v) => Value::Text(v),
                            SqlValue::Blob(v) => Value::Blob(v),
                        })
                        .collect()
                })
                .collect())
        }
    }
    fn database() -> rusqlite::Connection {
        let db = sql_test_support::database();
        db.execute_batch(include_str!(
            "../../../templates/trailbase/sql/iap_subscriptions.sql"
        ))
        .unwrap();
        db
    }
    fn map_order(db: &rusqlite::Connection) {
        db.execute_batch("INSERT INTO iap_orders (order_id,user_id,product_id,status,provider_status,created_at,updated_at)
            VALUES ('order',X'01','monthly','GRANTED','PURCHASED',1,1)").unwrap();
    }
    fn event(occurred: &str, status: &str) -> SubscriptionStatusEvent {
        let raw = json!({"eventType":"subscription.status_changed","eventVersion":"1.0","occurredAt":occurred,
            "orderId":"order","sku":"monthly","changeReason":"RENEWED","subscription":{"current":{
                "status":status,"accessGranted":status=="ACTIVE","expiresAt":"2026-10-01T00:00:00","autoRenew":true}}});
        match parse_subscription_webhook(&raw).unwrap() {
            SubscriptionWebhook::StatusChanged(e) => e,
            _ => unreachable!(),
        }
    }
    #[test]
    fn inbox_replays_unmapped_events_and_deduplicates_after_mapping() {
        let mut db = database();
        let e = event("2026-09-01T00:00:00", "ACTIVE");
        assert_eq!(
            apply_event(&mut db, &e, 1).unwrap(),
            SubscriptionApplyOutcome::UnmappedOrder
        );
        map_order(&db);
        assert_eq!(
            apply_event(&mut db, &e, 2).unwrap(),
            SubscriptionApplyOutcome::Applied
        );
        assert_eq!(
            apply_event(&mut db, &e, 3).unwrap(),
            SubscriptionApplyOutcome::Duplicate
        );
        assert_eq!(
            db.query_row("SELECT count(*) FROM iap_subscription_events", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            1
        );
    }
    #[test]
    fn unverified_orders_cannot_bind_or_expose_entitlements() {
        for (status, provider) in [
            ("NOT_FOUND", "NOT_FOUND"),
            ("FAILED", "ERROR"),
            ("UNKNOWN", "UNKNOWN"),
            ("PENDING", "ORDER_IN_PROGRESS"),
            ("GRANTED", "NOT_FOUND"),
            ("FAILED", "PURCHASED"),
        ] {
            let mut db = database();
            map_order(&db);
            let e = event("2026-09-01T00:00:00", "ACTIVE");
            db.execute(
                "UPDATE iap_orders SET status=?1,provider_status=?2",
                [status, provider],
            )
            .unwrap();
            assert_eq!(
                apply_event(&mut db, &e, 1).unwrap(),
                SubscriptionApplyOutcome::UnmappedOrder
            );
            assert_eq!(
                db.query_row("SELECT disposition FROM iap_subscription_events", [], |r| r
                    .get::<_, String>(0))
                    .unwrap(),
                "RECEIVED"
            );
            assert!(
                entitlement_for_user(&mut db, "order", &[1])
                    .unwrap()
                    .is_none()
            );
            db.execute(
                "UPDATE iap_orders SET status='GRANTED',provider_status='PURCHASED'",
                [],
            )
            .unwrap();
            assert_eq!(
                apply_event(&mut db, &e, 2).unwrap(),
                SubscriptionApplyOutcome::Applied
            );
            assert!(
                entitlement_for_user(&mut db, "order", &[1])
                    .unwrap()
                    .is_some()
            );
            assert!(
                entitlement_for_user(&mut db, "order", &[2])
                    .unwrap()
                    .is_none()
            );
            // Also deny a projection created before the verification guard.
            db.execute(
                "UPDATE iap_orders SET status=?1,provider_status=?2",
                [status, provider],
            )
            .unwrap();
            assert!(
                entitlement_for_user(&mut db, "order", &[1])
                    .unwrap()
                    .is_none()
            );
        }
    }

    #[test]
    fn registration_only_accepts_absent_or_supported_version() {
        let mut value = json!({"eventType":"callback.registration_verification","occurredAt":"2026-09-01T00:00:00"});
        assert!(parse_subscription_webhook(&value).is_ok());
        value["eventVersion"] = json!("1.0");
        assert!(parse_subscription_webhook(&value).is_ok());
        for version in [json!("2.0"), json!(null), json!(1), json!("")] {
            value["eventVersion"] = version;
            assert!(parse_subscription_webhook(&value).is_err());
        }
    }
    #[test]
    fn stale_and_same_timestamp_conflicts_cannot_overwrite_current_status() {
        let mut db = database();
        map_order(&db);
        let e = event("2026-09-02T00:00:00", "REVOKED");
        apply_event(&mut db, &e, 1).unwrap();
        assert_eq!(
            apply_event(&mut db, &event("2026-09-01T00:00:00", "ACTIVE"), 2).unwrap(),
            SubscriptionApplyOutcome::Stale
        );
        assert_eq!(
            apply_event(&mut db, &event("2026-09-02T00:00:00", "ACTIVE"), 3).unwrap(),
            SubscriptionApplyOutcome::Conflict
        );
        assert_eq!(
            db.query_row(
                "SELECT status,needs_reconciliation FROM iap_subscription_entitlements",
                [],
                |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))
            )
            .unwrap(),
            ("REVOKED".into(), 1)
        );
        assert_eq!(
            apply_event(&mut db, &event("2026-09-03T00:00:00", "ACTIVE"), 4).unwrap(),
            SubscriptionApplyOutcome::Applied
        );
        assert_eq!(
            db.query_row(
                "SELECT needs_reconciliation FROM iap_subscription_entitlements",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
            0
        );
    }
    #[test]
    fn validates_versions_required_expiry_and_provider_local_timestamps() {
        for timestamp in [
            "2026-02-30T00:00:00",
            "2026-09-01T24:00:00",
            "2026-09-01T00:00:00Z",
            "2026-09-01T00:00:00+09:00",
        ] {
            assert!(normalize_provider_local_timestamp(timestamp).is_err());
        }
        assert_eq!(
            normalize_provider_local_timestamp("2026-09-01T00:00:00.1").unwrap(),
            "2026-09-01T00:00:00.100000000"
        );
        let mut e = event("2026-09-01T00:00:00", "ACTIVE");
        e.event_version = "2.0".into();
        assert!(apply_event(&mut database(), &e, 1).is_err());
        assert!(
            serde_json::from_value::<SubscriptionSnapshot>(
                json!({"status":"ACTIVE","accessGranted":true,"autoRenew":true})
            )
            .is_err()
        );
    }
    #[test]
    fn entitlement_honors_revocation_expiry_conflict_and_grace_access() {
        let mut s = event("2026-09-01T00:00:00", "ACTIVE").subscription.current;
        assert!(subscription_access_allowed(&s, false, "2026-09-12T00:00:00").unwrap());
        assert!(!subscription_access_allowed(&s, false, "2026-10-01T00:00:00").unwrap());
        assert!(!subscription_access_allowed(&s, true, "2026-09-12T00:00:00").unwrap());
        s.status = SubscriptionStatus::InGracePeriod;
        assert!(subscription_access_allowed(&s, false, "2026-10-01T00:00:00").unwrap());
        s.status = SubscriptionStatus::Revoked;
        assert!(!subscription_access_allowed(&s, false, "2026-09-12T00:00:00").unwrap());
    }
}
