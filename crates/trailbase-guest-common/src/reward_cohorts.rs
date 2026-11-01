//! Point-reward cohorts and eligibility snapshots for app-owned reward schedules.
//! Server time is the only authority: never derive a cohort, window or period from a
//! device clock, local storage or a client value. Every window end is exclusive.
//! Call inside the caller's transaction; commit on success, roll back on every error.
use serde::Serialize;
use sha2::{Digest, Sha256};
use trailbase_wasm::db::{Transaction, Value};
#[cfg(not(test))]
use trailbase_wasm::rand::get_random_bytes;

use crate::db::{self, SqlStore};
use crate::responses::{ApiResult, bad_request, conflict, forbidden, internal, not_found};

pub const DAY_MS: i64 = 86_400_000;
/// Korea Standard Time has no daylight saving time, so a fixed offset is exact.
pub const KST_OFFSET_MS: i64 = 9 * 3_600_000;
// 9999-12-31T23:59:59.999Z keeps local-day arithmetic far from overflow.
const MAX_TIMESTAMP_MS: i64 = 253_402_300_799_999;
const SUBJECT_DOMAIN: &str = "trailbase-apps-in-toss-kit:reward-subject:v1\n";

/// Local calendar day number for a millisecond timestamp at a fixed UTC offset.
pub fn local_day(timestamp_ms: i64, utc_offset_ms: i64) -> i64 {
    (timestamp_ms + utc_offset_ms).div_euclid(DAY_MS)
}

/// First millisecond of a local day returned by [`local_day`].
pub fn local_day_start(day: i64, utc_offset_ms: i64) -> i64 {
    day * DAY_MS - utc_offset_ms
}

/// Domain-separated digest of a stable, app-scoped subject such as a scoped identity
/// HMAC. Never pass a raw Toss user key or a value that changes when a profile is
/// recreated. Store and compare only this digest; never return it to clients.
pub fn reward_subject_hash(subject_key: &str) -> ApiResult<String> {
    if !(16..=256).contains(&subject_key.len())
        || subject_key
            .chars()
            .any(|c| c.is_whitespace() || c.is_control())
    {
        return Err(bad_request(
            "INVALID_REWARD_SUBJECT",
            "Invalid reward subject",
        ));
    }
    Ok(hex::encode(Sha256::digest(format!(
        "{SUBJECT_DOMAIN}{subject_key}"
    ))))
}

/// Construct only from server configuration. Activate it after every instant is set.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RewardCohortPolicy {
    pub policy_version: String,
    /// Subjects first seen before this instant are LEGACY; at or after it, WELCOME.
    pub new_user_cutover_at: i64,
    /// Exclusive end of new point eligibility for every LEGACY subject.
    pub legacy_points_earn_ends_at: i64,
    /// Local days of welcome eligibility, counting the first-seen day as day 1.
    pub welcome_point_days: i64,
    pub utc_offset_ms: i64,
}

impl RewardCohortPolicy {
    /// A policy evaluated on Korea Standard Time days.
    pub fn kst(
        policy_version: impl Into<String>,
        new_user_cutover_at: i64,
        legacy_points_earn_ends_at: i64,
        welcome_point_days: i64,
    ) -> Self {
        Self {
            policy_version: policy_version.into(),
            new_user_cutover_at,
            legacy_points_earn_ends_at,
            welcome_point_days,
            utc_offset_ms: KST_OFFSET_MS,
        }
    }

    pub fn validate(&self) -> ApiResult<()> {
        if !identifier(&self.policy_version)
            || !valid_timestamp(self.new_user_cutover_at)
            || !valid_timestamp(self.legacy_points_earn_ends_at)
            || !(1..=366).contains(&self.welcome_point_days)
            || !(-14 * 3_600_000..=14 * 3_600_000).contains(&self.utc_offset_ms)
        {
            return Err(bad_request(
                "INVALID_REWARD_POLICY",
                "Invalid reward cohort policy",
            ));
        }
        Ok(())
    }

    /// Exclusive end of the welcome window for a subject first seen at `first_seen_at`.
    pub fn welcome_points_ends_at(&self, first_seen_at: i64) -> i64 {
        local_day_start(
            local_day(first_seen_at, self.utc_offset_ms) + self.welcome_point_days,
            self.utc_offset_ms,
        )
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RewardCohort {
    Legacy,
    Welcome,
}
impl RewardCohort {
    fn as_str(self) -> &'static str {
        match self {
            Self::Legacy => "LEGACY",
            Self::Welcome => "WELCOME",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RewardSubjectCohort {
    #[serde(skip)]
    pub subject_hash: String,
    pub cohort: RewardCohort,
    pub first_seen_at: i64,
    pub welcome_points_ends_at: Option<i64>,
    pub policy_version: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PointWindowStatus {
    LegacyGrace,
    Welcome,
    Ended,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PointWindow {
    pub status: PointWindowStatus,
    pub cohort: RewardCohort,
    /// Exclusive end of new point eligibility for this subject.
    pub ends_at: i64,
}

impl RewardSubjectCohort {
    /// LEGACY follows the current server policy; WELCOME keeps its registered end.
    pub fn points_earn_ends_at(&self, policy: &RewardCohortPolicy) -> i64 {
        match self.cohort {
            RewardCohort::Legacy => policy.legacy_points_earn_ends_at,
            RewardCohort::Welcome => self.welcome_points_ends_at.unwrap_or(self.first_seen_at),
        }
    }

    /// `achieved_at` is the server time the condition was met (a check-in or restore
    /// commit), never the attendance day it refers to.
    pub fn can_earn_points_at(&self, policy: &RewardCohortPolicy, achieved_at: i64) -> bool {
        achieved_at < self.points_earn_ends_at(policy)
    }

    pub fn point_window(&self, policy: &RewardCohortPolicy, now: i64) -> PointWindow {
        let ends_at = self.points_earn_ends_at(policy);
        let status = match (now < ends_at, self.cohort) {
            (false, _) => PointWindowStatus::Ended,
            (true, RewardCohort::Legacy) => PointWindowStatus::LegacyGrace,
            (true, RewardCohort::Welcome) => PointWindowStatus::Welcome,
        };
        PointWindow {
            status,
            cohort: self.cohort,
            ends_at,
        }
    }
}

const INSERT_SUBJECT: &str = "INSERT INTO reward_subject_cohorts
    (subject_hash,cohort,first_seen_at,welcome_points_ends_at,policy_version,created_at)
    VALUES (?1,?2,?3,?4,?5,?6) ON CONFLICT(subject_hash) DO NOTHING";
const FIND_SUBJECT: &str = "SELECT subject_hash,cohort,first_seen_at,welcome_points_ends_at,
    policy_version FROM reward_subject_cohorts WHERE subject_hash=?1";

fn register_subject<S: SqlStore>(
    store: &mut S,
    subject_key: &str,
    first_seen_at: i64,
    policy: &RewardCohortPolicy,
    now: i64,
) -> ApiResult<RewardSubjectCohort> {
    policy.validate()?;
    let subject_hash = reward_subject_hash(subject_key)?;
    if !valid_timestamp(first_seen_at) || !valid_timestamp(now) || first_seen_at > now {
        return Err(bad_request(
            "INVALID_REWARD_SUBJECT",
            "Invalid first-seen time",
        ));
    }
    let (cohort, welcome_end) = if first_seen_at < policy.new_user_cutover_at {
        (RewardCohort::Legacy, Value::Null)
    } else {
        (
            RewardCohort::Welcome,
            Value::Integer(policy.welcome_points_ends_at(first_seen_at)),
        )
    };
    store.execute_rows(
        INSERT_SUBJECT,
        &[
            Value::Text(subject_hash.clone()),
            Value::Text(cohort.as_str().into()),
            Value::Integer(first_seen_at),
            welcome_end,
            Value::Text(policy.policy_version.clone()),
            Value::Integer(now),
        ],
    )?;
    find_subject(store, &subject_hash)?
        .ok_or_else(|| internal("Reward subject registration failed"))
}

fn find_subject<S: SqlStore>(
    store: &mut S,
    subject_hash: &str,
) -> ApiResult<Option<RewardSubjectCohort>> {
    let rows = store.query_rows(FIND_SUBJECT, &[Value::Text(subject_hash.into())])?;
    rows.first().map(|row| parse_subject(row)).transpose()
}

fn parse_subject(row: &[Value]) -> ApiResult<RewardSubjectCohort> {
    if row.len() != 5 {
        return Err(internal("Unexpected reward subject row width"));
    }
    let cohort = match db::text(&row[1], "cohort")?.as_str() {
        "LEGACY" => RewardCohort::Legacy,
        "WELCOME" => RewardCohort::Welcome,
        _ => return Err(internal("Invalid reward cohort")),
    };
    Ok(RewardSubjectCohort {
        subject_hash: db::text(&row[0], "subject_hash")?,
        cohort,
        first_seen_at: db::integer(&row[2], "first_seen_at")?,
        welcome_points_ends_at: db::nullable_integer(&row[3])?,
        policy_version: db::text(&row[4], "policy_version")?,
    })
}

/// Register a subject once. The first registration wins: later calls, a recreated
/// profile, a policy-version change or a new campaign never move or restart it.
/// Pass the earliest verifiable first-use time (for example the original profile
/// created_at), never the time of the first request after an app update.
pub fn register_reward_subject_tx(
    tx: &mut Transaction,
    subject_key: &str,
    first_seen_at: i64,
    policy: &RewardCohortPolicy,
    now: i64,
) -> ApiResult<RewardSubjectCohort> {
    register_subject(tx, subject_key, first_seen_at, policy, now)
}

pub fn find_reward_subject_tx(
    tx: &mut Transaction,
    subject_key: &str,
) -> ApiResult<Option<RewardSubjectCohort>> {
    let subject_hash = reward_subject_hash(subject_key)?;
    find_subject(tx, &subject_hash)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PointEligibilityBasis {
    Welcome,
    LegacyGrace,
}
impl PointEligibilityBasis {
    fn as_str(self) -> &'static str {
        match self {
            Self::Welcome => "WELCOME",
            Self::LegacyGrace => "LEGACY_GRACE",
        }
    }
}

/// Server-derived inputs only. The provider code and amount are copied from the
/// `promotion_campaigns` row in the same statement, never from the client.
#[derive(Debug, Clone)]
pub struct PointEligibilityInput<'a> {
    pub reward_kind: &'a str,
    pub period_start: i64,
    pub period_end: i64,
    /// The campaign the server selected for a new eligibility at `earned_at`.
    pub campaign_id: &'a str,
    /// Server time the condition was met. Window checks use this, not the period.
    pub earned_at: i64,
    /// Exclusive end of the first claim, for example the next local day.
    pub claim_deadline_at: i64,
    /// Lifetime cap per subject and reward kind, e.g. one welcome streak reward.
    pub max_per_subject: Option<i64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PointEligibilityOutcome {
    Recorded,
    /// This owner already recorded this exact period; returned unchanged.
    Existing,
    /// The window ended before `earned_at`; nothing is recorded.
    WindowClosed,
    /// The subject has this or an overlapping period on another record, such as a
    /// deleted earlier account. Nothing is recorded.
    Overlapping,
    LimitReached,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PointEligibility {
    pub id: String,
    pub reward_kind: String,
    pub period_start: i64,
    pub period_end: i64,
    pub campaign_id: String,
    #[serde(skip)]
    pub provider_promotion_code: String,
    pub reward_amount: i64,
    pub basis: PointEligibilityBasis,
    pub policy_version: String,
    pub earned_at: i64,
    pub claim_deadline_at: i64,
    pub claim_ledger_id: Option<String>,
    pub claimed_at: Option<i64>,
}

impl PointEligibility {
    /// An unclaimed eligibility can start its first claim until the deadline. Budget,
    /// campaign and provider state still need checking when the claim starts.
    pub fn first_claim_open_at(&self, now: i64) -> bool {
        self.claim_ledger_id.is_none() && now < self.claim_deadline_at
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PointEligibilityRecord {
    pub outcome: PointEligibilityOutcome,
    pub eligibility: Option<PointEligibility>,
}

const ELIGIBILITY_COLUMNS: &str = "id,reward_kind,period_start,period_end,campaign_id,
    provider_promotion_code,reward_amount,basis,policy_version,earned_at,claim_deadline_at,
    claim_ledger_id,claimed_at";

fn record_eligibility<S: SqlStore>(
    store: &mut S,
    user: &[u8],
    subject: &RewardSubjectCohort,
    policy: &RewardCohortPolicy,
    input: &PointEligibilityInput<'_>,
    now: i64,
) -> ApiResult<PointEligibilityRecord> {
    policy.validate()?;
    if user.is_empty()
        || subject.subject_hash.len() != 64
        || !identifier(input.reward_kind)
        || !identifier(input.campaign_id)
        || input.period_end < input.period_start
        || !valid_timestamp(now)
        || !valid_timestamp(input.earned_at)
        || input.earned_at > now
        || input.claim_deadline_at <= input.earned_at
        || input.max_per_subject.is_some_and(|max| max < 1)
    {
        return Err(bad_request(
            "INVALID_POINT_ELIGIBILITY",
            "Invalid point eligibility",
        ));
    }
    let scope = vec![
        Value::Text(subject.subject_hash.clone()),
        Value::Text(input.reward_kind.into()),
        Value::Integer(input.period_start),
        Value::Integer(input.period_end),
    ];
    let mut overlap_params = scope.clone();
    overlap_params.push(Value::Blob(user.to_vec()));
    let overlapping = store.query_rows(
        &format!(
            "SELECT {ELIGIBILITY_COLUMNS},
            period_start=?3 AND period_end=?4 AND user_id IS ?5 AS same
            FROM promotion_reward_eligibilities
            WHERE subject_hash=?1 AND reward_kind=?2 AND period_start<=?4 AND period_end>=?3
            ORDER BY same DESC LIMIT 1"
        ),
        &overlap_params,
    )?;
    if let Some(row) = overlapping.first() {
        // An eligibility met inside its window survives the window's end unchanged.
        // The same period on a deleted or other account is never recorded again.
        if row.len() == 14 && db::integer(&row[13], "same")? == 1 {
            return Ok(PointEligibilityRecord {
                outcome: PointEligibilityOutcome::Existing,
                eligibility: Some(parse_eligibility(&row[..13])?),
            });
        }
        return Ok(PointEligibilityRecord {
            outcome: PointEligibilityOutcome::Overlapping,
            eligibility: None,
        });
    }
    let unrecorded = |outcome| {
        Ok(PointEligibilityRecord {
            outcome,
            eligibility: None,
        })
    };
    if !subject.can_earn_points_at(policy, input.earned_at) {
        return unrecorded(PointEligibilityOutcome::WindowClosed);
    }
    if let Some(max) = input.max_per_subject {
        let rows = store.query_rows(
            "SELECT count(*) FROM promotion_reward_eligibilities WHERE subject_hash=?1 AND reward_kind=?2",
            &scope[..2],
        )?;
        if db::integer(&rows[0][0], "count")? >= max {
            return unrecorded(PointEligibilityOutcome::LimitReached);
        }
    }
    let basis = match subject.cohort {
        RewardCohort::Legacy => PointEligibilityBasis::LegacyGrace,
        RewardCohort::Welcome => PointEligibilityBasis::Welcome,
    };
    let mut random = [0u8; 24];
    fill_random(&mut random);
    let id = hex::encode(random);
    let inserted = store.execute_rows(
        "INSERT INTO promotion_reward_eligibilities
        (id,user_id,subject_hash,reward_kind,period_start,period_end,campaign_id,
         provider_promotion_code,reward_amount,basis,policy_version,earned_at,claim_deadline_at,created_at)
        SELECT ?5,?6,?1,?2,?3,?4,c.id,c.provider_promotion_code,c.reward_amount,?7,?8,?9,?10,?11
        FROM promotion_campaigns c WHERE c.id=?12",
        &[
            scope[0].clone(),
            scope[1].clone(),
            scope[2].clone(),
            scope[3].clone(),
            Value::Text(id.clone()),
            Value::Blob(user.to_vec()),
            Value::Text(basis.as_str().into()),
            Value::Text(policy.policy_version.clone()),
            Value::Integer(input.earned_at),
            Value::Integer(input.claim_deadline_at),
            Value::Integer(now),
            Value::Text(input.campaign_id.into()),
        ],
    )?;
    if inserted != 1 {
        return Err(not_found(
            "PROMOTION_CAMPAIGN_NOT_FOUND",
            "Promotion campaign not found",
        ));
    }
    let eligibility = find_eligibility_by_id(store, user, &id)?
        .ok_or_else(|| internal("Point eligibility was not recorded"))?;
    Ok(PointEligibilityRecord {
        outcome: PointEligibilityOutcome::Recorded,
        eligibility: Some(eligibility),
    })
}

fn find_eligibility_by_id<S: SqlStore>(
    store: &mut S,
    user: &[u8],
    id: &str,
) -> ApiResult<Option<PointEligibility>> {
    if user.is_empty() || !receipt_id(id) {
        return Err(bad_request(
            "INVALID_POINT_ELIGIBILITY",
            "Invalid point eligibility ID",
        ));
    }
    let rows = store.query_rows(
        &format!(
            "SELECT {ELIGIBILITY_COLUMNS} FROM promotion_reward_eligibilities WHERE id=?1 AND user_id=?2"
        ),
        &[Value::Text(id.into()), Value::Blob(user.to_vec())],
    )?;
    rows.first().map(|row| parse_eligibility(row)).transpose()
}

fn mark_claimed<S: SqlStore>(
    store: &mut S,
    user: &[u8],
    id: &str,
    ledger_id: &str,
    now: i64,
) -> ApiResult<PointEligibility> {
    if ledger_id.is_empty() || ledger_id.len() > 128 || !valid_timestamp(now) {
        return Err(bad_request(
            "INVALID_POINT_ELIGIBILITY",
            "Invalid point eligibility claim",
        ));
    }
    let eligibility = find_eligibility_by_id(store, user, id)?
        .ok_or_else(|| not_found("POINT_ELIGIBILITY_NOT_FOUND", "Point eligibility not found"))?;
    match eligibility.claim_ledger_id.as_deref() {
        Some(existing) if existing == ledger_id => return Ok(eligibility),
        Some(_) => {
            return Err(conflict(
                "POINT_ELIGIBILITY_ALREADY_CLAIMED",
                "Point eligibility already has a claim",
            ));
        }
        None => {}
    }
    if !eligibility.first_claim_open_at(now) {
        return Err(forbidden(
            "POINT_ELIGIBILITY_CLAIM_EXPIRED",
            "The first claim period has ended",
        ));
    }
    let updated = store.execute_rows(
        "UPDATE promotion_reward_eligibilities SET claim_ledger_id=?3,claimed_at=?4
        WHERE id=?1 AND user_id=?2 AND claim_ledger_id IS NULL AND claim_deadline_at>?4",
        &[
            Value::Text(id.into()),
            Value::Blob(user.to_vec()),
            Value::Text(ledger_id.into()),
            Value::Integer(now),
        ],
    )?;
    if updated != 1 {
        return Err(conflict(
            "POINT_ELIGIBILITY_ALREADY_CLAIMED",
            "Point eligibility already has a claim",
        ));
    }
    Ok(PointEligibility {
        claim_ledger_id: Some(ledger_id.into()),
        claimed_at: Some(now),
        ..eligibility
    })
}

/// Snapshot a point condition met inside the subject's window. An existing
/// eligibility for the same period is returned unchanged, even after the window ends
/// or the active campaign changes; an overlapping period of the same kind is never
/// recorded. Choose the campaign with the server's current selection for new
/// eligibilities only. Recording neither reserves budget nor guarantees payment.
pub fn record_point_eligibility_tx(
    tx: &mut Transaction,
    user: &[u8],
    subject: &RewardSubjectCohort,
    policy: &RewardCohortPolicy,
    input: &PointEligibilityInput<'_>,
    now: i64,
) -> ApiResult<PointEligibilityRecord> {
    record_eligibility(tx, user, subject, policy, input, now)
}

pub fn find_point_eligibility_tx(
    tx: &mut Transaction,
    user: &[u8],
    id: &str,
) -> ApiResult<Option<PointEligibility>> {
    find_eligibility_by_id(tx, user, id)
}

/// Most recent eligibilities owned by `user`, for a claim-history screen.
pub fn list_point_eligibilities_tx(
    tx: &mut Transaction,
    user: &[u8],
    limit: i64,
) -> ApiResult<Vec<PointEligibility>> {
    list_eligibilities(tx, user, limit)
}

fn list_eligibilities<S: SqlStore>(
    store: &mut S,
    user: &[u8],
    limit: i64,
) -> ApiResult<Vec<PointEligibility>> {
    if user.is_empty() || !(1..=100).contains(&limit) {
        return Err(bad_request(
            "INVALID_POINT_ELIGIBILITY",
            "Invalid point eligibility query",
        ));
    }
    store
        .query_rows(
            &format!(
                "SELECT {ELIGIBILITY_COLUMNS} FROM promotion_reward_eligibilities
            WHERE user_id=?1 ORDER BY earned_at DESC, id LIMIT ?2"
            ),
            &[Value::Blob(user.to_vec()), Value::Integer(limit)],
        )?
        .iter()
        .map(|row| parse_eligibility(row))
        .collect()
}

/// Link the first claim's promotion ledger ID before or with the ledger insert in the
/// same transaction. Repeating the same ledger ID is a replay; another ID conflicts.
/// Checking an existing claim later is not a first claim and needs no open deadline.
pub fn mark_point_eligibility_claimed_tx(
    tx: &mut Transaction,
    user: &[u8],
    id: &str,
    ledger_id: &str,
    now: i64,
) -> ApiResult<PointEligibility> {
    mark_claimed(tx, user, id, ledger_id, now)
}

fn parse_eligibility(row: &[Value]) -> ApiResult<PointEligibility> {
    if row.len() != 13 {
        return Err(internal("Unexpected point eligibility row width"));
    }
    let basis = match db::text(&row[7], "basis")?.as_str() {
        "WELCOME" => PointEligibilityBasis::Welcome,
        "LEGACY_GRACE" => PointEligibilityBasis::LegacyGrace,
        _ => return Err(internal("Invalid point eligibility basis")),
    };
    Ok(PointEligibility {
        id: db::text(&row[0], "id")?,
        reward_kind: db::text(&row[1], "reward_kind")?,
        period_start: db::integer(&row[2], "period_start")?,
        period_end: db::integer(&row[3], "period_end")?,
        campaign_id: db::text(&row[4], "campaign_id")?,
        provider_promotion_code: db::text(&row[5], "provider_promotion_code")?,
        reward_amount: db::integer(&row[6], "reward_amount")?,
        basis,
        policy_version: db::text(&row[8], "policy_version")?,
        earned_at: db::integer(&row[9], "earned_at")?,
        claim_deadline_at: db::integer(&row[10], "claim_deadline_at")?,
        claim_ledger_id: db::nullable_text(&row[11])?,
        claimed_at: db::nullable_integer(&row[12])?,
    })
}

pub(crate) fn identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 64
        && value
            .bytes()
            .all(|v| v.is_ascii_alphanumeric() || b"._-".contains(&v))
}
pub(crate) fn valid_timestamp(value: i64) -> bool {
    (0..=MAX_TIMESTAMP_MS).contains(&value)
}
pub(crate) fn receipt_id(id: &str) -> bool {
    id.len() == 48
        && id
            .bytes()
            .all(|v| v.is_ascii_digit() || (b'a'..=b'f').contains(&v))
}

#[cfg(not(test))]
pub(crate) fn fill_random(bytes: &mut [u8]) {
    get_random_bytes(bytes);
}
#[cfg(test)]
pub(crate) fn fill_random(bytes: &mut [u8]) {
    use std::sync::atomic::{AtomicU64, Ordering};
    static SEQUENCE: AtomicU64 = AtomicU64::new(1);
    bytes[..8].copy_from_slice(&SEQUENCE.fetch_add(1, Ordering::Relaxed).to_le_bytes());
}

#[cfg(test)]
mod tests;
