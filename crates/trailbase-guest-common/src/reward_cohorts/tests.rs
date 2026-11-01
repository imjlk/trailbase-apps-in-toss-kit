use super::*;
use rusqlite::Connection;

const SUBJECT: &str = "scoped-identity-hmac-0001";
// 2026-11-02T00:00:00+09:00
const CUTOVER: i64 = 1_793_545_200_000;
const LEGACY_END: i64 = CUTOVER + 7 * DAY_MS;

fn policy() -> RewardCohortPolicy {
    RewardCohortPolicy::kst("reward-v1", CUTOVER, LEGACY_END, 7)
}
fn database() -> Connection {
    let db = crate::sql_test_support::database_with(&[
        "reward_subject_cohorts.sql",
        "promotion_reward_eligibilities.sql",
    ]);
    db.execute_batch(
        "INSERT INTO _user VALUES (X'02');
        INSERT INTO promotion_campaigns
        (id,feature_key,provider_promotion_code,reward_amount,status,starts_at,ends_at,budget_limit_amount,created_at,updated_at)
        VALUES ('weekly-50','attendance_weekly','CODE-50',50,'ACTIVE',0,9999999999999,100000,0,0)",
    )
    .unwrap();
    db
}
fn eligibility_count(db: &Connection) -> i64 {
    db.query_row(
        "SELECT count(*) FROM promotion_reward_eligibilities",
        [],
        |r| r.get(0),
    )
    .unwrap()
}
fn input(start: i64, end: i64, earned_at: i64) -> PointEligibilityInput<'static> {
    PointEligibilityInput {
        reward_kind: "attendance_weekly",
        period_start: start,
        period_end: end,
        campaign_id: "weekly-50",
        earned_at,
        claim_deadline_at: earned_at + 7 * DAY_MS,
        max_per_subject: None,
    }
}

#[test]
fn local_days_follow_kst_midnight() {
    let day = local_day(CUTOVER, KST_OFFSET_MS);
    assert_eq!(local_day_start(day, KST_OFFSET_MS), CUTOVER);
    assert_eq!(local_day(CUTOVER - 1, KST_OFFSET_MS), day - 1);
    assert_eq!(local_day(CUTOVER + DAY_MS - 1, KST_OFFSET_MS), day);
    // A UTC date boundary is not a KST day boundary.
    assert_eq!(local_day(CUTOVER + 9 * 3_600_000, KST_OFFSET_MS), day);
}

#[test]
fn subject_hash_is_stable_domain_separated_and_rejects_unsafe_keys() {
    let hash = reward_subject_hash(SUBJECT).unwrap();
    assert_eq!(hash, reward_subject_hash(SUBJECT).unwrap());
    assert_eq!(hash.len(), 64);
    assert_ne!(hash, hex::encode(Sha256::digest(SUBJECT)));
    for bad in [
        "short",
        " scoped-identity-hmac",
        "scoped identity hmac 0001",
    ] {
        assert!(reward_subject_hash(bad).is_err(), "{bad}");
    }
    assert!(reward_subject_hash(&"x".repeat(257)).is_err());
}

#[test]
fn policy_validation_rejects_incomplete_configuration() {
    assert!(policy().validate().is_ok());
    for bad in [
        RewardCohortPolicy {
            welcome_point_days: 0,
            ..policy()
        },
        RewardCohortPolicy {
            policy_version: String::new(),
            ..policy()
        },
        RewardCohortPolicy {
            new_user_cutover_at: -1,
            ..policy()
        },
        RewardCohortPolicy {
            utc_offset_ms: 15 * 3_600_000,
            ..policy()
        },
    ] {
        assert!(bad.validate().is_err());
    }
}

#[test]
fn welcome_window_counts_first_local_day_and_ends_exclusively_on_day_eight() {
    let mut db = database();
    let late_first_day = CUTOVER + DAY_MS - 1;
    let subject =
        register_subject(&mut db, SUBJECT, late_first_day, &policy(), late_first_day).unwrap();
    assert_eq!(subject.cohort, RewardCohort::Welcome);
    let ends = CUTOVER + 7 * DAY_MS;
    assert_eq!(subject.welcome_points_ends_at, Some(ends));
    assert!(subject.can_earn_points_at(&policy(), ends - 1));
    assert!(!subject.can_earn_points_at(&policy(), ends));
    assert_eq!(
        subject.point_window(&policy(), ends - 1).status,
        PointWindowStatus::Welcome
    );
    assert_eq!(
        subject.point_window(&policy(), ends),
        PointWindow {
            status: PointWindowStatus::Ended,
            cohort: RewardCohort::Welcome,
            ends_at: ends,
        }
    );
}

#[test]
fn legacy_subjects_follow_the_server_grace_end_and_cutover_is_welcome() {
    let mut db = database();
    let legacy = register_subject(&mut db, SUBJECT, CUTOVER - 1, &policy(), CUTOVER).unwrap();
    assert_eq!(legacy.cohort, RewardCohort::Legacy);
    assert_eq!(legacy.welcome_points_ends_at, None);
    assert_eq!(
        legacy.point_window(&policy(), CUTOVER).status,
        PointWindowStatus::LegacyGrace
    );
    assert_eq!(
        legacy.point_window(&policy(), LEGACY_END).status,
        PointWindowStatus::Ended
    );
    let extended = RewardCohortPolicy {
        legacy_points_earn_ends_at: LEGACY_END + DAY_MS,
        ..policy()
    };
    assert!(legacy.can_earn_points_at(&extended, LEGACY_END));
    let at_cutover = register_subject(
        &mut db,
        "scoped-identity-hmac-0002",
        CUTOVER,
        &policy(),
        CUTOVER,
    )
    .unwrap();
    assert_eq!(at_cutover.cohort, RewardCohort::Welcome);
}

#[test]
fn first_registration_wins_over_later_visits_and_policy_changes() {
    let mut db = database();
    let first = register_subject(&mut db, SUBJECT, CUTOVER + 10, &policy(), CUTOVER + 10).unwrap();
    let later = RewardCohortPolicy {
        policy_version: "reward-v2".into(),
        welcome_point_days: 30,
        ..policy()
    };
    // A recreated profile reports a later first use; an older value is ignored too.
    for seen in [CUTOVER + 20 * DAY_MS, CUTOVER - DAY_MS] {
        let again =
            register_subject(&mut db, SUBJECT, seen, &later, CUTOVER + 21 * DAY_MS).unwrap();
        assert_eq!(again, first);
    }
    assert!(register_subject(&mut db, SUBJECT, CUTOVER + 10, &policy(), CUTOVER).is_err());
    assert_eq!(
        find_subject(&mut db, &reward_subject_hash(SUBJECT).unwrap()).unwrap(),
        Some(first)
    );
}

#[test]
fn eligibility_snapshots_campaign_values_and_survives_campaign_and_window_changes() {
    let mut db = database();
    let subject = register_subject(&mut db, SUBJECT, CUTOVER, &policy(), CUTOVER).unwrap();
    let earned = CUTOVER + 6 * DAY_MS;
    let first = record_eligibility(
        &mut db,
        &[1],
        &subject,
        &policy(),
        &input(1, 7, earned),
        earned,
    )
    .unwrap();
    assert_eq!(first.outcome, PointEligibilityOutcome::Recorded);
    let stored = first.eligibility.unwrap();
    assert_eq!(stored.reward_amount, 50);
    assert_eq!(stored.provider_promotion_code, "CODE-50");
    assert_eq!(stored.basis, PointEligibilityBasis::Welcome);
    assert!(stored.first_claim_open_at(CUTOVER + 7 * DAY_MS));
    let json = serde_json::to_value(&stored).unwrap();
    assert!(json.get("providerPromotionCode").is_none());

    db.execute_batch(
        "UPDATE promotion_campaigns SET reward_amount=30, provider_promotion_code='CODE-30'",
    )
    .unwrap();
    let after_window = CUTOVER + 8 * DAY_MS;
    let replay = record_eligibility(
        &mut db,
        &[1],
        &subject,
        &policy(),
        &input(1, 7, after_window),
        after_window,
    )
    .unwrap();
    assert_eq!(replay.outcome, PointEligibilityOutcome::Existing);
    assert_eq!(replay.eligibility, Some(stored));
    assert_eq!(eligibility_count(&db), 1);
}

#[test]
fn closed_window_overlap_cap_and_missing_campaign_record_nothing() {
    let mut db = database();
    let subject = register_subject(&mut db, SUBJECT, CUTOVER, &policy(), CUTOVER).unwrap();
    let ends = CUTOVER + 7 * DAY_MS;
    let closed = record_eligibility(
        &mut db,
        &[1],
        &subject,
        &policy(),
        &input(8, 14, ends),
        ends,
    )
    .unwrap();
    assert_eq!(closed.outcome, PointEligibilityOutcome::WindowClosed);
    // A restore after the window cannot create a past period's new eligibility.
    let restored =
        record_eligibility(&mut db, &[1], &subject, &policy(), &input(1, 7, ends), ends).unwrap();
    assert_eq!(restored.outcome, PointEligibilityOutcome::WindowClosed);

    let once = PointEligibilityInput {
        max_per_subject: Some(1),
        ..input(1, 7, ends - 1)
    };
    assert_eq!(
        record_eligibility(&mut db, &[1], &subject, &policy(), &once, ends - 1)
            .unwrap()
            .outcome,
        PointEligibilityOutcome::Recorded
    );
    let overlap = record_eligibility(
        &mut db,
        &[1],
        &subject,
        &policy(),
        &input(3, 9, ends - 1),
        ends - 1,
    )
    .unwrap();
    assert_eq!(overlap.outcome, PointEligibilityOutcome::Overlapping);
    let second = PointEligibilityInput {
        max_per_subject: Some(1),
        ..input(8, 8, ends - 1)
    };
    assert_eq!(
        record_eligibility(&mut db, &[1], &subject, &policy(), &second, ends - 1)
            .unwrap()
            .outcome,
        PointEligibilityOutcome::LimitReached
    );
    let missing = PointEligibilityInput {
        campaign_id: "missing",
        ..input(20, 20, ends - 1)
    };
    assert_eq!(
        record_eligibility(&mut db, &[1], &subject, &policy(), &missing, ends - 1)
            .unwrap_err()
            .code,
        "PROMOTION_CAMPAIGN_NOT_FOUND"
    );
    assert_eq!(eligibility_count(&db), 1);
}

#[test]
fn legacy_basis_and_invalid_inputs() {
    let mut db = database();
    let subject = register_subject(&mut db, SUBJECT, CUTOVER - 1, &policy(), CUTOVER).unwrap();
    let recorded = record_eligibility(
        &mut db,
        &[1],
        &subject,
        &policy(),
        &input(1, 1, CUTOVER),
        CUTOVER,
    )
    .unwrap();
    assert_eq!(
        recorded.eligibility.unwrap().basis,
        PointEligibilityBasis::LegacyGrace
    );
    for bad in [
        input(2, 1, CUTOVER),
        PointEligibilityInput {
            claim_deadline_at: CUTOVER,
            ..input(2, 2, CUTOVER)
        },
        PointEligibilityInput {
            max_per_subject: Some(0),
            ..input(2, 2, CUTOVER)
        },
        input(2, 2, CUTOVER + 1),
    ] {
        assert!(record_eligibility(&mut db, &[1], &subject, &policy(), &bad, CUTOVER).is_err());
    }
    assert!(
        record_eligibility(
            &mut db,
            &[],
            &subject,
            &policy(),
            &input(2, 2, CUTOVER),
            CUTOVER
        )
        .is_err()
    );
    assert_eq!(eligibility_count(&db), 1);
}

#[test]
fn first_claim_links_one_ledger_and_honors_the_deadline() {
    let mut db = database();
    let subject = register_subject(&mut db, SUBJECT, CUTOVER, &policy(), CUTOVER).unwrap();
    let id = record_eligibility(
        &mut db,
        &[1],
        &subject,
        &policy(),
        &input(1, 7, CUTOVER),
        CUTOVER,
    )
    .unwrap()
    .eligibility
    .unwrap()
    .id;
    let deadline = CUTOVER + 7 * DAY_MS;
    assert!(
        find_eligibility_by_id(&mut db, &[2], &id)
            .unwrap()
            .is_none()
    );
    assert_eq!(
        mark_claimed(&mut db, &[2], &id, "ledger-1", CUTOVER)
            .unwrap_err()
            .code,
        "POINT_ELIGIBILITY_NOT_FOUND"
    );
    let claimed = mark_claimed(&mut db, &[1], &id, "ledger-1", deadline - 1).unwrap();
    assert_eq!(claimed.claim_ledger_id.as_deref(), Some("ledger-1"));
    // Rechecking an existing claim after the deadline replays it.
    assert_eq!(
        mark_claimed(&mut db, &[1], &id, "ledger-1", deadline + DAY_MS).unwrap(),
        claimed
    );
    assert_eq!(
        mark_claimed(&mut db, &[1], &id, "ledger-2", deadline - 1)
            .unwrap_err()
            .code,
        "POINT_ELIGIBILITY_ALREADY_CLAIMED"
    );
    let late = record_eligibility(
        &mut db,
        &[1],
        &subject,
        &policy(),
        &input(8, 8, CUTOVER),
        CUTOVER,
    )
    .unwrap()
    .eligibility
    .unwrap();
    assert_eq!(
        mark_claimed(&mut db, &[1], &late.id, "ledger-3", deadline)
            .unwrap_err()
            .code,
        "POINT_ELIGIBILITY_CLAIM_EXPIRED"
    );
    assert_eq!(list_eligibilities(&mut db, &[1], 10).unwrap().len(), 2);
    assert!(list_eligibilities(&mut db, &[1], 0).is_err());
}

#[test]
fn account_erasure_keeps_subject_history_without_restarting_rewards() {
    let mut db = database();
    let subject = register_subject(&mut db, SUBJECT, CUTOVER, &policy(), CUTOVER).unwrap();
    record_eligibility(
        &mut db,
        &[1],
        &subject,
        &policy(),
        &input(1, 7, CUTOVER),
        CUTOVER,
    )
    .unwrap();
    db.execute_batch("DELETE FROM _user WHERE id=X'01'")
        .unwrap();
    let owner: Option<Vec<u8>> = db
        .query_row(
            "SELECT user_id FROM promotion_reward_eligibilities",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(owner, None);
    // The same identity on a new account keeps its first-seen window and period.
    let rejoined = register_subject(
        &mut db,
        SUBJECT,
        CUTOVER + 3 * DAY_MS,
        &policy(),
        CUTOVER + 3 * DAY_MS,
    )
    .unwrap();
    assert_eq!(rejoined, subject);
    let again = record_eligibility(
        &mut db,
        &[2],
        &rejoined,
        &policy(),
        &input(1, 7, CUTOVER + 3 * DAY_MS),
        CUTOVER + 3 * DAY_MS,
    )
    .unwrap();
    assert_eq!(again.outcome, PointEligibilityOutcome::Overlapping);
    assert_eq!(eligibility_count(&db), 1);
}
