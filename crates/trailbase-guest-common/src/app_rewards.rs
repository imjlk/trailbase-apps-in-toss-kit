//! App-owned AD/SHARE credit ledger, not Toss payments or proof of SDK events.
//! Authenticate a non-disabled principal before every call. All policies are server
//! code and run inside the caller's transaction. Commit on success, roll back on
//! every error. Never make network calls or external grants inside these closures.
use serde::Serialize;
use trailbase_wasm::db::{Transaction, Value};
#[cfg(not(test))]
use trailbase_wasm::rand::get_random_bytes;

use crate::db;
use crate::responses::{ApiResult, bad_request, forbidden, internal, not_found};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AppRewardSource {
    Ad,
    Share,
}
impl AppRewardSource {
    fn as_str(self) -> &'static str {
        match self {
            Self::Ad => "AD",
            Self::Share => "SHARE",
        }
    }
}

/// Construct only from server configuration and eligibility/quota checks.
/// No Deserialize implementation: never use client amounts or units as an offer.
pub struct AppRewardOffer {
    pub policy_version: String,
    pub unit: String,
    pub amount: i64,
    pub ttl_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppRewardAttempt {
    pub id: String,
    pub placement_id: String,
    pub source: AppRewardSource,
    pub policy_version: String,
    pub reward_unit: String,
    pub reward_amount: i64,
    pub expires_at: i64,
    pub created_at: i64,
    pub granted_at: Option<i64>,
}

pub(crate) const INSERT_ATTEMPT: &str = "INSERT INTO app_reward_attempts
    (id,user_id,placement_id,source,policy_version,reward_unit,reward_amount,created_at,expires_at)
    VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)";
pub(crate) const FIND_ATTEMPT: &str = "SELECT a.id,a.placement_id,a.source,a.policy_version,
    a.reward_unit,a.reward_amount,a.expires_at,g.granted_at,a.created_at
    FROM app_reward_attempts a LEFT JOIN app_reward_grants g ON g.attempt_id=a.id
    WHERE a.id=?1 AND a.user_id=?2 AND a.placement_id=?3";
pub(crate) const INSERT_GRANT: &str = "INSERT INTO app_reward_grants (attempt_id,granted_at)
    SELECT id,?4 FROM app_reward_attempts
    WHERE id=?1 AND user_id=?2 AND placement_id=?3 AND created_at<=?4 AND expires_at>?4
    ON CONFLICT(attempt_id) DO NOTHING";

/// Issue a random server ID only after a mandatory server policy approves an offer.
/// The policy must check placement, enabled state, quotas and principal eligibility.
fn issue_attempt<T: RewardDatabase>(
    tx: &mut T,
    user: &[u8],
    placement: &str,
    source: AppRewardSource,
    now: i64,
    policy: impl FnOnce(&mut T) -> ApiResult<AppRewardOffer>,
) -> ApiResult<AppRewardAttempt> {
    validate_context(user, placement, now)?;
    let offer = policy(tx)?;
    if !identifier(&offer.policy_version)
        || !identifier(&offer.unit)
        || !(1..=1_000_000_000).contains(&offer.amount)
        || !(1..=86_400_000).contains(&offer.ttl_ms)
    {
        return Err(bad_request(
            "INVALID_REWARD_OFFER",
            "Invalid server reward offer",
        ));
    }
    let expires = now
        .checked_add(offer.ttl_ms)
        .ok_or_else(|| bad_request("INVALID_REWARD_OFFER", "Reward expiry overflow"))?;
    let mut random = [0u8; 24];
    fill_random(&mut random);
    let id = hex::encode(random);
    let attempt = AppRewardAttempt {
        id,
        placement_id: placement.into(),
        source,
        policy_version: offer.policy_version,
        reward_unit: offer.unit,
        reward_amount: offer.amount,
        expires_at: expires,
        created_at: now,
        granted_at: None,
    };
    tx.execute_reward(
        INSERT_ATTEMPT,
        &[
            Value::Text(attempt.id.clone()),
            Value::Blob(user.to_vec()),
            Value::Text(placement.into()),
            Value::Text(source.as_str().into()),
            Value::Text(attempt.policy_version.clone()),
            Value::Text(attempt.reward_unit.clone()),
            Value::Integer(attempt.reward_amount),
            Value::Integer(now),
            Value::Integer(expires),
        ],
    )?;
    Ok(attempt)
}

/// Owner/placement-scoped result lookup works after expiry and while entry is paused.
/// A present granted_at is the committed local credit; expiry alone does not undo it.
fn find_attempt<T: RewardDatabase>(
    tx: &mut T,
    user: &[u8],
    placement: &str,
    id: &str,
) -> ApiResult<Option<AppRewardAttempt>> {
    validate_scope(user, placement)?;
    validate_id(id)?;
    let rows = tx.query_reward(FIND_ATTEMPT, &scope_params(user, placement, id))?;
    rows.first().map(|row| parse_attempt(row)).transpose()
}

/// Claim the local credit atomically once. A repeated claim returns its original
/// receipt, even after expiry, without rerunning a policy or crediting again.
/// For a new grant the mandatory policy must verify server eligibility, current
/// feature gate, amount/policy version and quota in this transaction. Attempt IDs,
/// client events, timestamps and elapsed duration are not evidence of ad viewing
/// or sharing. The closure must reject by default when it cannot establish policy.
fn claim_attempt<T: RewardDatabase>(
    tx: &mut T,
    user: &[u8],
    placement: &str,
    id: &str,
    now: i64,
    policy: impl FnOnce(&mut T, &AppRewardAttempt) -> ApiResult<bool>,
) -> ApiResult<AppRewardAttempt> {
    validate_context(user, placement, now)?;
    let attempt = find_attempt(tx, user, placement, id)?
        .ok_or_else(|| not_found("REWARD_NOT_FOUND", "Reward attempt not found"))?;
    if attempt.granted_at.is_some() {
        return Ok(attempt);
    }
    if now < attempt.created_at {
        return Err(forbidden(
            "REWARD_NOT_CLAIMABLE",
            "Reward attempt is not claimable at this time",
        ));
    }
    if attempt.expires_at <= now {
        return Err(forbidden("REWARD_EXPIRED", "Reward attempt expired"));
    }
    if !policy(tx, &attempt)? {
        return Err(forbidden(
            "REWARD_INELIGIBLE",
            "Server reward policy did not approve",
        ));
    }
    let mut params = scope_params(user, placement, id);
    params.push(Value::Integer(now));
    if tx.execute_reward(INSERT_GRANT, &params)? != 1 {
        return Err(forbidden(
            "REWARD_NOT_CLAIMABLE",
            "Reward attempt is not claimable at this time",
        ));
    }
    // The ledger row IS the app credit. Do not invoke another grant after commit.
    Ok(AppRewardAttempt {
        granted_at: Some(now),
        ..attempt
    })
}

#[cfg(not(test))]
fn fill_random(bytes: &mut [u8]) {
    get_random_bytes(bytes);
}
#[cfg(test)]
fn fill_random(bytes: &mut [u8]) {
    use std::sync::atomic::{AtomicU64, Ordering};
    static SEQUENCE: AtomicU64 = AtomicU64::new(1);
    bytes[..8].copy_from_slice(&SEQUENCE.fetch_add(1, Ordering::Relaxed).to_le_bytes());
}

// Keep the public boundary tied to TrailBase transactions; the private executor
// lets tests exercise the exact orchestration and SQL on SQLite.
trait RewardDatabase {
    fn query_reward(&mut self, sql: &str, params: &[Value]) -> ApiResult<Vec<Vec<Value>>>;
    fn execute_reward(&mut self, sql: &str, params: &[Value]) -> ApiResult<u64>;
}
impl RewardDatabase for Transaction {
    fn query_reward(&mut self, sql: &str, params: &[Value]) -> ApiResult<Vec<Vec<Value>>> {
        db::tx_query(self, sql, params)
    }
    fn execute_reward(&mut self, sql: &str, params: &[Value]) -> ApiResult<u64> {
        db::tx_execute(self, sql, params)
    }
}

/// Issue after a mandatory server offer policy; roll back the transaction on error.
/// The server owns placement eligibility, limits, amount, unit and expiry.
pub fn issue_app_reward_attempt_tx(
    tx: &mut Transaction,
    user: &[u8],
    placement: &str,
    source: AppRewardSource,
    now: i64,
    policy: impl FnOnce(&mut Transaction) -> ApiResult<AppRewardOffer>,
) -> ApiResult<AppRewardAttempt> {
    crate::operation_policy::enforce_configured_operation_tx(
        tx,
        crate::operation_policy::OperationFeature::AppReward,
        crate::operation_policy::OperationPhase::Entry,
    )?;
    issue_attempt(tx, user, placement, source, now, policy)
}

/// Look up only the authenticated owner's placement. Remains available when paused.
pub fn find_app_reward_attempt_tx(
    tx: &mut Transaction,
    user: &[u8],
    placement: &str,
    id: &str,
) -> ApiResult<Option<AppRewardAttempt>> {
    find_attempt(tx, user, placement, id)
}

/// Grant a local ledger credit once, after server policy approval in this transaction.
/// SDK events/attempt IDs are not proof. No external side effects in the policy.
/// Commit on success and roll back on any error. A duplicate returns its receipt
/// without running the policy again. Never issue another credit after commit.
pub fn claim_app_reward_attempt_tx(
    tx: &mut Transaction,
    user: &[u8],
    placement: &str,
    id: &str,
    now: i64,
    policy: impl FnOnce(&mut Transaction, &AppRewardAttempt) -> ApiResult<bool>,
) -> ApiResult<AppRewardAttempt> {
    claim_attempt(tx, user, placement, id, now, |tx, attempt| {
        crate::operation_policy::enforce_configured_operation_tx(
            tx,
            crate::operation_policy::OperationFeature::AppReward,
            crate::operation_policy::OperationPhase::Settlement,
        )?;
        policy(tx, attempt)
    })
}

fn scope_params(user: &[u8], placement: &str, id: &str) -> Vec<Value> {
    vec![
        Value::Text(id.into()),
        Value::Blob(user.to_vec()),
        Value::Text(placement.into()),
    ]
}
fn identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 64
        && value
            .bytes()
            .all(|v| v.is_ascii_alphanumeric() || b"._-".contains(&v))
}
fn validate_context(user: &[u8], placement: &str, now: i64) -> ApiResult<()> {
    validate_scope(user, placement)?;
    if now < 0 {
        return Err(bad_request(
            "INVALID_REWARD_CONTEXT",
            "Invalid reward context",
        ));
    }
    Ok(())
}
fn validate_scope(user: &[u8], placement: &str) -> ApiResult<()> {
    if user.is_empty() || !identifier(placement) {
        return Err(bad_request(
            "INVALID_REWARD_CONTEXT",
            "Invalid reward context",
        ));
    }
    Ok(())
}
fn validate_id(id: &str) -> ApiResult<()> {
    if id.len() != 48
        || !id
            .bytes()
            .all(|v| v.is_ascii_digit() || (b'a'..=b'f').contains(&v))
    {
        return Err(bad_request(
            "INVALID_REWARD_ID",
            "Invalid reward attempt ID",
        ));
    }
    Ok(())
}
fn parse_attempt(row: &[Value]) -> ApiResult<AppRewardAttempt> {
    if row.len() != 9 {
        return Err(internal("Unexpected reward row width"));
    }
    let source = match db::text(&row[2], "source")?.as_str() {
        "AD" => AppRewardSource::Ad,
        "SHARE" => AppRewardSource::Share,
        _ => return Err(internal("Invalid reward source")),
    };
    Ok(AppRewardAttempt {
        id: db::text(&row[0], "id")?,
        placement_id: db::text(&row[1], "placement_id")?,
        source,
        policy_version: db::text(&row[3], "policy_version")?,
        reward_unit: db::text(&row[4], "reward_unit")?,
        reward_amount: db::integer(&row[5], "reward_amount")?,
        expires_at: db::integer(&row[6], "expires_at")?,
        granted_at: db::nullable_integer(&row[7])?,
        created_at: db::integer(&row[8], "created_at")?,
    })
}

#[cfg(test)]
mod tests;
