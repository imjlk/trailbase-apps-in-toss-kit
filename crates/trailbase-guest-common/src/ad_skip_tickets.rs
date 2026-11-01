//! App-owned ad skip tickets: a server balance, once-only grants and idempotent
//! redemptions. A ticket skips one full-screen ad in this app only. It is never a
//! Toss promotion, cash or point value, and no SDK ad event is created for it.
//! Authenticate a non-disabled principal before every call and read the owner from
//! the verified session. Call inside the caller's transaction; commit on success and
//! roll back on every error. Never make network calls inside the policy closures.
use serde::Serialize;
use trailbase_wasm::db::{Transaction, Value};

use crate::db::{self, SqlStore};
use crate::responses::{ApiResult, bad_request, conflict, forbidden, internal};
use crate::reward_cohorts::{fill_random, identifier, reward_subject_hash, valid_timestamp};

/// Construct only from server attendance or reward state, never from client input.
#[derive(Debug, Clone)]
pub struct AdSkipGrant<'a> {
    /// Stable app-scoped identity, hashed with `reward_subject_hash` before storage.
    pub subject_key: &'a str,
    /// Grant cause, for example `daily_attendance` or `streak_bonus`.
    pub cause: &'a str,
    /// Inclusive cause period, for example one local day or a completed cycle.
    pub period_start: i64,
    pub period_end: i64,
    pub quantity: i64,
    pub policy_version: &'a str,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AdSkipGrantOutcome {
    Granted,
    /// The subject already received this exact cause period, possibly on an
    /// earlier account. Nothing changes, including after a quantity change.
    AlreadyGranted,
    /// Another period of the same cause overlaps this one. Nothing is granted.
    Overlapping,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdSkipGrantResult {
    pub outcome: AdSkipGrantOutcome,
    pub granted: i64,
    pub balance: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AdOpportunityResolution {
    Ad,
    Ticket,
    Free,
}
impl AdOpportunityResolution {
    fn as_str(self) -> &'static str {
        match self {
            Self::Ad => "AD",
            Self::Ticket => "TICKET",
            Self::Free => "FREE",
        }
    }
    fn parse(value: &str) -> ApiResult<Self> {
        match value {
            "AD" => Ok(Self::Ad),
            "TICKET" => Ok(Self::Ticket),
            "FREE" => Ok(Self::Free),
            _ => Err(internal("Invalid ad opportunity resolution")),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdOpportunity {
    pub placement: String,
    pub opportunity_key: String,
    pub resolution: AdOpportunityResolution,
    pub reference: String,
    pub resolved_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AdOpportunityClaim {
    /// This call recorded the resolution. Apply its effect now.
    Claimed(AdOpportunity),
    /// Another path resolved it first. Do not apply a second effect.
    AlreadyResolved(AdOpportunity),
}

/// A client redemption request. `request_id` is the client idempotency key and must
/// be reused for every retry of the same choice. `opportunity_key` names one ad
/// prompt, for example a server ad cycle, so a later prompt gets a new key.
#[derive(Debug, Clone)]
pub struct AdSkipRedeemRequest<'a> {
    pub request_id: &'a str,
    pub placement: &'a str,
    pub opportunity_key: &'a str,
    /// Small opaque continuation context, such as the original feature request ID.
    /// Never put identities, tokens or personal data in it.
    pub context: &'a str,
}

/// Read-only server decision for a new redemption.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AdSkipEligibility {
    /// An ad is required now and one ticket can resolve it.
    Due,
    /// No ad is required now; continue without charging.
    Free,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AdSkipRedemptionResolution {
    Ticket,
    Free,
    AlreadyResolved,
}
impl AdSkipRedemptionResolution {
    fn as_str(self) -> &'static str {
        match self {
            Self::Ticket => "TICKET",
            Self::Free => "FREE",
            Self::AlreadyResolved => "ALREADY_RESOLVED",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdSkipRedemption {
    pub receipt_id: String,
    pub request_id: String,
    pub placement: String,
    pub opportunity_key: String,
    pub context: String,
    pub resolution: AdSkipRedemptionResolution,
    pub consumed: i64,
    /// Server balance now. On a replay this is the current balance, not the original.
    pub balance: i64,
    pub replayed: bool,
    /// How the opportunity was resolved when this receipt did not charge for it.
    pub opportunity: Option<AdOpportunity>,
    pub created_at: i64,
}

const WALLET_CREDIT: &str = "INSERT INTO ad_skip_ticket_wallets (user_id,balance,updated_at)
    VALUES (?1,?2,?3) ON CONFLICT(user_id) DO UPDATE
    SET balance=balance+excluded.balance, updated_at=excluded.updated_at";
const WALLET_DEBIT: &str = "UPDATE ad_skip_ticket_wallets SET balance=balance-1, updated_at=?2
    WHERE user_id=?1 AND balance>=1";
const CLAIM_OPPORTUNITY: &str = "INSERT INTO ad_skip_opportunities
    (user_id,placement,opportunity_key,resolution,reference,resolved_at)
    VALUES (?1,?2,?3,?4,?5,?6) ON CONFLICT(user_id,placement,opportunity_key) DO NOTHING";
const FIND_OPPORTUNITY: &str = "SELECT placement,opportunity_key,resolution,reference,resolved_at
    FROM ad_skip_opportunities WHERE user_id=?1 AND placement=?2 AND opportunity_key=?3";
const FIND_REDEMPTION: &str = "SELECT id,request_id,placement,opportunity_key,context,resolution,
    consumed,created_at FROM ad_skip_ticket_redemptions WHERE user_id=?1 AND request_id=?2";
const INSERT_REDEMPTION: &str = "INSERT INTO ad_skip_ticket_redemptions
    (id,user_id,request_id,placement,opportunity_key,context,resolution,consumed,balance_after,created_at)
    VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)";

fn balance<S: SqlStore>(store: &mut S, user: &[u8]) -> ApiResult<i64> {
    let rows = store.query_rows(
        "SELECT balance FROM ad_skip_ticket_wallets WHERE user_id=?1",
        &[Value::Blob(user.to_vec())],
    )?;
    rows.first()
        .map(|row| db::integer(&row[0], "balance"))
        .unwrap_or(Ok(0))
}

fn grant_tickets<S: SqlStore>(
    store: &mut S,
    user: &[u8],
    grant: &AdSkipGrant<'_>,
    now: i64,
) -> ApiResult<AdSkipGrantResult> {
    let subject_hash = reward_subject_hash(grant.subject_key)?;
    if user.is_empty()
        || !identifier(grant.cause)
        || !identifier(grant.policy_version)
        || grant.period_end < grant.period_start
        || !(1..=1000).contains(&grant.quantity)
        || !valid_timestamp(now)
    {
        return Err(bad_request(
            "INVALID_AD_SKIP_GRANT",
            "Invalid ad skip ticket grant",
        ));
    }
    let overlapping = store.query_rows(
        "SELECT period_start=?3 AND period_end=?4 FROM ad_skip_ticket_grants
        WHERE subject_hash=?1 AND cause=?2 AND period_start<=?4 AND period_end>=?3
        ORDER BY 1 DESC LIMIT 1",
        &[
            Value::Text(subject_hash.clone()),
            Value::Text(grant.cause.into()),
            Value::Integer(grant.period_start),
            Value::Integer(grant.period_end),
        ],
    )?;
    if let Some(row) = overlapping.first() {
        let outcome = if db::integer(&row[0], "exact")? == 1 {
            AdSkipGrantOutcome::AlreadyGranted
        } else {
            AdSkipGrantOutcome::Overlapping
        };
        return Ok(AdSkipGrantResult {
            outcome,
            granted: 0,
            balance: balance(store, user)?,
        });
    }
    store.execute_rows(
        "INSERT INTO ad_skip_ticket_grants
        (user_id,subject_hash,cause,period_start,period_end,quantity,policy_version,created_at)
        VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
        &[
            Value::Blob(user.to_vec()),
            Value::Text(subject_hash),
            Value::Text(grant.cause.into()),
            Value::Integer(grant.period_start),
            Value::Integer(grant.period_end),
            Value::Integer(grant.quantity),
            Value::Text(grant.policy_version.into()),
            Value::Integer(now),
        ],
    )?;
    store.execute_rows(
        WALLET_CREDIT,
        &[
            Value::Blob(user.to_vec()),
            Value::Integer(grant.quantity),
            Value::Integer(now),
        ],
    )?;
    Ok(AdSkipGrantResult {
        outcome: AdSkipGrantOutcome::Granted,
        granted: grant.quantity,
        balance: balance(store, user)?,
    })
}

fn find_opportunity<S: SqlStore>(
    store: &mut S,
    user: &[u8],
    placement: &str,
    opportunity_key: &str,
) -> ApiResult<Option<AdOpportunity>> {
    let rows = store.query_rows(
        FIND_OPPORTUNITY,
        &[
            Value::Blob(user.to_vec()),
            Value::Text(placement.into()),
            Value::Text(opportunity_key.into()),
        ],
    )?;
    rows.first()
        .map(|row| {
            Ok(AdOpportunity {
                placement: db::text(&row[0], "placement")?,
                opportunity_key: db::text(&row[1], "opportunity_key")?,
                resolution: AdOpportunityResolution::parse(&db::text(&row[2], "resolution")?)?,
                reference: db::text(&row[3], "reference")?,
                resolved_at: db::integer(&row[4], "resolved_at")?,
            })
        })
        .transpose()
}

fn claim_opportunity<S: SqlStore>(
    store: &mut S,
    user: &[u8],
    placement: &str,
    opportunity_key: &str,
    resolution: AdOpportunityResolution,
    reference: &str,
    now: i64,
) -> ApiResult<AdOpportunityClaim> {
    if user.is_empty()
        || !identifier(placement)
        || !opportunity(opportunity_key)
        || !opportunity(reference)
        || !valid_timestamp(now)
    {
        return Err(bad_request(
            "INVALID_AD_OPPORTUNITY",
            "Invalid ad opportunity",
        ));
    }
    let inserted = store.execute_rows(
        CLAIM_OPPORTUNITY,
        &[
            Value::Blob(user.to_vec()),
            Value::Text(placement.into()),
            Value::Text(opportunity_key.into()),
            Value::Text(resolution.as_str().into()),
            Value::Text(reference.into()),
            Value::Integer(now),
        ],
    )?;
    let stored = find_opportunity(store, user, placement, opportunity_key)?
        .ok_or_else(|| internal("Ad opportunity was not recorded"))?;
    Ok(if inserted == 1 {
        AdOpportunityClaim::Claimed(stored)
    } else {
        AdOpportunityClaim::AlreadyResolved(stored)
    })
}

fn find_redemption<S: SqlStore>(
    store: &mut S,
    user: &[u8],
    request_id: &str,
) -> ApiResult<Option<AdSkipRedemption>> {
    let rows = store.query_rows(
        FIND_REDEMPTION,
        &[Value::Blob(user.to_vec()), Value::Text(request_id.into())],
    )?;
    let Some(row) = rows.first() else {
        return Ok(None);
    };
    if row.len() != 8 {
        return Err(internal("Unexpected ad skip redemption row width"));
    }
    let resolution = match db::text(&row[5], "resolution")?.as_str() {
        "TICKET" => AdSkipRedemptionResolution::Ticket,
        "FREE" => AdSkipRedemptionResolution::Free,
        "ALREADY_RESOLVED" => AdSkipRedemptionResolution::AlreadyResolved,
        _ => return Err(internal("Invalid ad skip redemption resolution")),
    };
    let placement = db::text(&row[2], "placement")?;
    let opportunity_key = db::text(&row[3], "opportunity_key")?;
    let opportunity = if resolution == AdSkipRedemptionResolution::AlreadyResolved {
        find_opportunity(store, user, &placement, &opportunity_key)?
    } else {
        None
    };
    Ok(Some(AdSkipRedemption {
        receipt_id: db::text(&row[0], "id")?,
        request_id: db::text(&row[1], "request_id")?,
        placement,
        opportunity_key,
        context: db::text(&row[4], "context")?,
        resolution,
        consumed: db::integer(&row[6], "consumed")?,
        balance: balance(store, user)?,
        replayed: true,
        opportunity,
        created_at: db::integer(&row[7], "created_at")?,
    }))
}

fn write_redemption<S: SqlStore>(
    store: &mut S,
    user: &[u8],
    request: &AdSkipRedeemRequest<'_>,
    receipt: &str,
    resolution: AdSkipRedemptionResolution,
    opportunity: Option<AdOpportunity>,
    now: i64,
) -> ApiResult<AdSkipRedemption> {
    let consumed = i64::from(resolution == AdSkipRedemptionResolution::Ticket);
    let balance = balance(store, user)?;
    store.execute_rows(
        INSERT_REDEMPTION,
        &[
            Value::Text(receipt.into()),
            Value::Blob(user.to_vec()),
            Value::Text(request.request_id.into()),
            Value::Text(request.placement.into()),
            Value::Text(request.opportunity_key.into()),
            Value::Text(request.context.into()),
            Value::Text(resolution.as_str().into()),
            Value::Integer(consumed),
            Value::Integer(balance),
            Value::Integer(now),
        ],
    )?;
    Ok(AdSkipRedemption {
        receipt_id: receipt.into(),
        request_id: request.request_id.into(),
        placement: request.placement.into(),
        opportunity_key: request.opportunity_key.into(),
        context: request.context.into(),
        resolution,
        consumed,
        balance,
        replayed: false,
        opportunity,
        created_at: now,
    })
}

fn redeem<S: SqlStore>(
    store: &mut S,
    user: &[u8],
    request: &AdSkipRedeemRequest<'_>,
    now: i64,
    allowed_placements: &[&str],
    evaluate: impl FnOnce(&mut S, &AdSkipRedeemRequest<'_>) -> ApiResult<AdSkipEligibility>,
    resolve: impl FnOnce(&mut S, &AdSkipRedeemRequest<'_>) -> ApiResult<bool>,
) -> ApiResult<AdSkipRedemption> {
    validate_request(user, request, now)?;
    // A known request returns its original receipt before any current condition is
    // checked, so a retry can neither charge again nor reopen the opportunity.
    if let Some(existing) = find_redemption(store, user, request.request_id)? {
        if existing.placement != request.placement
            || existing.opportunity_key != request.opportunity_key
            || existing.context != request.context
        {
            return Err(conflict(
                "AD_SKIP_REQUEST_CONFLICT",
                "This request ID was used for another ad skip",
            ));
        }
        return Ok(existing);
    }
    if !allowed_placements.contains(&request.placement) {
        return Err(forbidden(
            "AD_SKIP_PLACEMENT_NOT_ALLOWED",
            "Ad skip tickets cannot be used here",
        ));
    }
    let mut random = [0u8; 24];
    fill_random(&mut random);
    let receipt = hex::encode(random);
    if let Some(resolved) =
        find_opportunity(store, user, request.placement, request.opportunity_key)?
    {
        return write_redemption(
            store,
            user,
            request,
            &receipt,
            AdSkipRedemptionResolution::AlreadyResolved,
            Some(resolved),
            now,
        );
    }
    if evaluate(store, request)? == AdSkipEligibility::Free {
        return write_redemption(
            store,
            user,
            request,
            &receipt,
            AdSkipRedemptionResolution::Free,
            None,
            now,
        );
    }
    if balance(store, user)? < 1 {
        return Err(conflict(
            "AD_SKIP_INSUFFICIENT_BALANCE",
            "No ad skip tickets are available",
        ));
    }
    // The consumer advances its own ad state here and must report whether this call
    // changed the current opportunity (for example one updated cycle row).
    if !resolve(store, request)? {
        return Err(conflict(
            "AD_SKIP_OPPORTUNITY_STALE",
            "This ad opportunity is no longer current",
        ));
    }
    let claim = claim_opportunity(
        store,
        user,
        request.placement,
        request.opportunity_key,
        AdOpportunityResolution::Ticket,
        &receipt,
        now,
    )?;
    if !matches!(claim, AdOpportunityClaim::Claimed(_)) {
        return Err(conflict(
            "AD_SKIP_OPPORTUNITY_STALE",
            "This ad opportunity is no longer current",
        ));
    }
    if store.execute_rows(
        WALLET_DEBIT,
        &[Value::Blob(user.to_vec()), Value::Integer(now)],
    )? != 1
    {
        return Err(conflict(
            "AD_SKIP_INSUFFICIENT_BALANCE",
            "No ad skip tickets are available",
        ));
    }
    write_redemption(
        store,
        user,
        request,
        &receipt,
        AdSkipRedemptionResolution::Ticket,
        None,
        now,
    )
}

/// Current server balance; zero when the owner has never received a ticket.
pub fn ad_skip_balance_tx(tx: &mut Transaction, user: &[u8]) -> ApiResult<i64> {
    if user.is_empty() {
        return Err(bad_request(
            "INVALID_AD_SKIP_OWNER",
            "Invalid ad skip ticket owner",
        ));
    }
    balance(tx, user)
}

/// Grant tickets for one cause period in the same transaction that records the
/// qualifying server event, such as an accepted check-in. The same subject never
/// receives the same or an overlapping period of a cause twice, even on a new
/// account. Keep it independent of Toss promotion calls and their failures.
pub fn grant_ad_skip_tickets_tx(
    tx: &mut Transaction,
    user: &[u8],
    grant: &AdSkipGrant<'_>,
    now: i64,
) -> ApiResult<AdSkipGrantResult> {
    grant_tickets(tx, user, grant, now)
}

/// Record how an ad opportunity was resolved by a non-ticket path: a completed
/// rewarded ad (`Ad`) or a free continuation such as a no-fill pass (`Free`). On
/// `AlreadyResolved`, skip the path's effect so a late ad callback cannot open a new
/// ad interval after a ticket already resolved the same opportunity.
pub fn claim_ad_opportunity_tx(
    tx: &mut Transaction,
    user: &[u8],
    placement: &str,
    opportunity_key: &str,
    resolution: AdOpportunityResolution,
    reference: &str,
    now: i64,
) -> ApiResult<AdOpportunityClaim> {
    if resolution == AdOpportunityResolution::Ticket {
        return Err(bad_request(
            "INVALID_AD_OPPORTUNITY",
            "Ticket resolutions are recorded by redemption only",
        ));
    }
    claim_opportunity(
        tx,
        user,
        placement,
        opportunity_key,
        resolution,
        reference,
        now,
    )
}

pub fn find_ad_opportunity_tx(
    tx: &mut Transaction,
    user: &[u8],
    placement: &str,
    opportunity_key: &str,
) -> ApiResult<Option<AdOpportunity>> {
    if user.is_empty() || !identifier(placement) || !opportunity(opportunity_key) {
        return Err(bad_request(
            "INVALID_AD_OPPORTUNITY",
            "Invalid ad opportunity",
        ));
    }
    find_opportunity(tx, user, placement, opportunity_key)
}

/// Redeem one ticket for one ad opportunity, at most once per request and opportunity.
///
/// Order: a known `request_id` returns its receipt (a different placement, key or
/// context conflicts); an unlisted placement is rejected without changes; an already
/// resolved opportunity returns `AlreadyResolved` without charging. Otherwise the
/// read-only `evaluate` closure decides: `Free` records a no-charge receipt; `Due`
/// requires a positive balance, then `resolve` must advance the consumer's ad state
/// and return true only if this call changed the current opportunity. The resolution,
/// debit and receipt are written last. Roll back on every error. Pass an empty
/// allowlist to pause redemption while keeping balances and grants.
pub fn redeem_ad_skip_ticket_tx(
    tx: &mut Transaction,
    user: &[u8],
    request: &AdSkipRedeemRequest<'_>,
    now: i64,
    allowed_placements: &[&str],
    evaluate: impl FnOnce(&mut Transaction, &AdSkipRedeemRequest<'_>) -> ApiResult<AdSkipEligibility>,
    resolve: impl FnOnce(&mut Transaction, &AdSkipRedeemRequest<'_>) -> ApiResult<bool>,
) -> ApiResult<AdSkipRedemption> {
    redeem(
        tx,
        user,
        request,
        now,
        allowed_placements,
        evaluate,
        resolve,
    )
}

/// Look up a receipt by its request ID without re-running any condition.
pub fn find_ad_skip_redemption_tx(
    tx: &mut Transaction,
    user: &[u8],
    request_id: &str,
) -> ApiResult<Option<AdSkipRedemption>> {
    if user.is_empty() || !request_key(request_id) {
        return Err(bad_request(
            "INVALID_AD_SKIP_REQUEST",
            "Invalid ad skip request",
        ));
    }
    find_redemption(tx, user, request_id)
}

fn validate_request(user: &[u8], request: &AdSkipRedeemRequest<'_>, now: i64) -> ApiResult<()> {
    if user.is_empty()
        || !request_key(request.request_id)
        || !identifier(request.placement)
        || !opportunity(request.opportunity_key)
        || !(request.context.is_empty() || opportunity(request.context))
        || !valid_timestamp(now)
    {
        return Err(bad_request(
            "INVALID_AD_SKIP_REQUEST",
            "Invalid ad skip request",
        ));
    }
    Ok(())
}
fn request_key(value: &str) -> bool {
    (16..=128).contains(&value.len())
        && value
            .bytes()
            .all(|v| v.is_ascii_alphanumeric() || b"_-".contains(&v))
}
fn opportunity(value: &str) -> bool {
    (1..=128).contains(&value.len())
        && value
            .bytes()
            .all(|v| v.is_ascii_alphanumeric() || b"._:-".contains(&v))
}

#[cfg(test)]
mod tests;
