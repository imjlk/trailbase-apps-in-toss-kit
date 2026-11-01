use super::*;
use rusqlite::Connection;

const SUBJECT: &str = "scoped-identity-hmac-0001";
const ALLOWED: &[&str] = &["generation_continue", "custom", "report"];
const NOW: i64 = 1_793_545_200_000;

fn database() -> Connection {
    let db = crate::sql_test_support::database_with(&["ad_skip_tickets.sql"]);
    db.execute_batch("INSERT INTO _user VALUES (X'02')")
        .unwrap();
    db
}
fn daily(day: i64) -> AdSkipGrant<'static> {
    AdSkipGrant {
        subject_key: SUBJECT,
        cause: "daily_attendance",
        period_start: day,
        period_end: day,
        quantity: 1,
        policy_version: "reward-v1",
    }
}
fn streak(start: i64, end: i64) -> AdSkipGrant<'static> {
    AdSkipGrant {
        cause: "streak_bonus",
        period_start: start,
        period_end: end,
        quantity: 3,
        ..daily(start)
    }
}
fn request(id: &'static str, key: &'static str) -> AdSkipRedeemRequest<'static> {
    AdSkipRedeemRequest {
        request_id: id,
        placement: "generation_continue",
        opportunity_key: key,
        context: "generation:req-1",
    }
}
fn count(db: &Connection, table: &str) -> i64 {
    db.query_row(&format!("SELECT count(*) FROM {table}"), [], |r| r.get(0))
        .unwrap()
}
fn funded(quantity: i64) -> Connection {
    let mut db = database();
    let mut grant = daily(1);
    grant.quantity = quantity;
    grant_tickets(&mut db, &[1], &grant, NOW).unwrap();
    db
}
fn due(_: &mut Connection, _: &AdSkipRedeemRequest<'_>) -> ApiResult<AdSkipEligibility> {
    Ok(AdSkipEligibility::Due)
}
fn advanced(_: &mut Connection, _: &AdSkipRedeemRequest<'_>) -> ApiResult<bool> {
    Ok(true)
}
fn unreachable_evaluate(
    _: &mut Connection,
    _: &AdSkipRedeemRequest<'_>,
) -> ApiResult<AdSkipEligibility> {
    panic!("evaluate must not run")
}
fn unreachable_resolve(_: &mut Connection, _: &AdSkipRedeemRequest<'_>) -> ApiResult<bool> {
    panic!("resolve must not run")
}

#[test]
fn daily_and_streak_grants_are_once_per_subject_period_and_independent() {
    let mut db = database();
    let first = grant_tickets(&mut db, &[1], &daily(7), NOW).unwrap();
    assert_eq!(
        first,
        AdSkipGrantResult {
            outcome: AdSkipGrantOutcome::Granted,
            granted: 1,
            balance: 1,
        }
    );
    // Retries, concurrent replays and a quantity change never add more.
    let mut changed = daily(7);
    changed.quantity = 2;
    for replay in [daily(7), changed] {
        let again = grant_tickets(&mut db, &[1], &replay, NOW + 1).unwrap();
        assert_eq!(again.outcome, AdSkipGrantOutcome::AlreadyGranted);
        assert_eq!(again.balance, 1);
    }
    // Day seven: the daily ticket plus the streak bonus make four in total.
    let bonus = grant_tickets(&mut db, &[1], &streak(1, 7), NOW).unwrap();
    assert_eq!(
        (bonus.outcome, bonus.balance),
        (AdSkipGrantOutcome::Granted, 4)
    );
    assert_eq!(
        grant_tickets(&mut db, &[1], &streak(3, 9), NOW)
            .unwrap()
            .outcome,
        AdSkipGrantOutcome::Overlapping
    );
    assert_eq!(
        grant_tickets(&mut db, &[1], &streak(8, 14), NOW)
            .unwrap()
            .balance,
        7
    );
    assert_eq!(count(&db, "ad_skip_ticket_grants"), 3);
}

#[test]
fn erasure_forfeits_balance_but_a_rejoined_identity_cannot_earn_the_same_period() {
    let mut db = database();
    grant_tickets(&mut db, &[1], &daily(7), NOW).unwrap();
    grant_tickets(&mut db, &[1], &streak(1, 7), NOW).unwrap();
    db.execute_batch("DELETE FROM _user WHERE id=X'01'")
        .unwrap();
    assert_eq!(count(&db, "ad_skip_ticket_wallets"), 0);
    assert_eq!(count(&db, "ad_skip_ticket_grants"), 2);
    assert_eq!(
        grant_tickets(&mut db, &[2], &daily(7), NOW).unwrap(),
        AdSkipGrantResult {
            outcome: AdSkipGrantOutcome::AlreadyGranted,
            granted: 0,
            balance: 0,
        }
    );
    assert_eq!(
        grant_tickets(&mut db, &[2], &streak(2, 8), NOW)
            .unwrap()
            .outcome,
        AdSkipGrantOutcome::Overlapping
    );
    assert_eq!(
        grant_tickets(&mut db, &[2], &daily(8), NOW)
            .unwrap()
            .balance,
        1
    );
}

#[test]
fn invalid_grants_change_nothing() {
    let mut db = database();
    for bad in [
        AdSkipGrant {
            quantity: 0,
            ..daily(1)
        },
        AdSkipGrant {
            period_end: 0,
            ..daily(1)
        },
        AdSkipGrant {
            cause: "bad cause",
            ..daily(1)
        },
        AdSkipGrant {
            subject_key: "short",
            ..daily(1)
        },
    ] {
        assert!(grant_tickets(&mut db, &[1], &bad, NOW).is_err());
    }
    assert!(grant_tickets(&mut db, &[], &daily(1), NOW).is_err());
    assert_eq!(count(&db, "ad_skip_ticket_grants"), 0);
}

#[test]
fn redemption_charges_once_and_replays_the_original_receipt() {
    let mut db = funded(2);
    let mut resolved = 0;
    let first = redeem(
        &mut db,
        &[1],
        &request("request-000000001", "cycle:4"),
        NOW,
        ALLOWED,
        due,
        |_, _| {
            resolved += 1;
            Ok(true)
        },
    )
    .unwrap();
    assert_eq!(resolved, 1);
    assert_eq!(first.resolution, AdSkipRedemptionResolution::Ticket);
    assert_eq!(
        (first.consumed, first.balance, first.replayed),
        (1, 1, false)
    );
    let replay = redeem(
        &mut db,
        &[1],
        &request("request-000000001", "cycle:4"),
        NOW + 5,
        ALLOWED,
        unreachable_evaluate,
        unreachable_resolve,
    )
    .unwrap();
    assert_eq!(
        replay,
        AdSkipRedemption {
            replayed: true,
            ..first.clone()
        }
    );
    assert_eq!(
        find_redemption(&mut db, &[1], "request-000000001").unwrap(),
        Some(replay)
    );
    assert!(
        find_redemption(&mut db, &[2], "request-000000001")
            .unwrap()
            .is_none()
    );
    assert_eq!(balance(&mut db, &[1]).unwrap(), 1);
}

#[test]
fn reused_request_id_for_another_choice_conflicts_without_changes() {
    let mut db = funded(2);
    redeem(
        &mut db,
        &[1],
        &request("request-000000001", "cycle:4"),
        NOW,
        ALLOWED,
        due,
        advanced,
    )
    .unwrap();
    let mut other_context = request("request-000000001", "cycle:4");
    other_context.context = "generation:req-2";
    let mut other_placement = request("request-000000001", "cycle:4");
    other_placement.placement = "report";
    for conflicting in [
        request("request-000000001", "cycle:5"),
        other_context,
        other_placement,
    ] {
        let error = redeem(
            &mut db,
            &[1],
            &conflicting,
            NOW,
            ALLOWED,
            unreachable_evaluate,
            unreachable_resolve,
        )
        .unwrap_err();
        assert_eq!(error.code, "AD_SKIP_REQUEST_CONFLICT");
    }
    assert_eq!(balance(&mut db, &[1]).unwrap(), 1);
    assert_eq!(count(&db, "ad_skip_ticket_redemptions"), 1);
}

#[test]
fn attendance_restore_and_unknown_placements_are_rejected_before_any_change() {
    let mut db = funded(1);
    for placement in ["attendance_restore", "banner", "unknown"] {
        let mut blocked = request("request-000000009", "restore:2026-11-01");
        blocked.placement = placement;
        let error = redeem(
            &mut db,
            &[1],
            &blocked,
            NOW,
            ALLOWED,
            unreachable_evaluate,
            unreachable_resolve,
        )
        .unwrap_err();
        assert_eq!(error.code, "AD_SKIP_PLACEMENT_NOT_ALLOWED");
    }
    // An empty allowlist pauses redemption while keeping the balance.
    assert_eq!(
        redeem(
            &mut db,
            &[1],
            &request("request-000000010", "cycle:1"),
            NOW,
            &[],
            unreachable_evaluate,
            unreachable_resolve
        )
        .unwrap_err()
        .code,
        "AD_SKIP_PLACEMENT_NOT_ALLOWED"
    );
    assert_eq!(balance(&mut db, &[1]).unwrap(), 1);
    assert_eq!(count(&db, "ad_skip_ticket_redemptions"), 0);
    assert_eq!(count(&db, "ad_skip_opportunities"), 0);
}

#[test]
fn empty_balance_fails_before_the_consumer_advances_its_ad_state() {
    let mut db = database();
    let error = redeem(
        &mut db,
        &[1],
        &request("request-000000001", "cycle:1"),
        NOW,
        ALLOWED,
        due,
        unreachable_resolve,
    )
    .unwrap_err();
    assert_eq!(error.code, "AD_SKIP_INSUFFICIENT_BALANCE");
    assert_eq!(count(&db, "ad_skip_ticket_redemptions"), 0);
}

#[test]
fn stale_consumer_state_rolls_back_without_charging() {
    let mut db = funded(1);
    db.execute_batch("BEGIN IMMEDIATE").unwrap();
    let error = redeem(
        &mut db,
        &[1],
        &request("request-000000001", "cycle:3"),
        NOW,
        ALLOWED,
        due,
        |_, _| Ok(false),
    )
    .unwrap_err();
    assert_eq!(error.code, "AD_SKIP_OPPORTUNITY_STALE");
    db.execute_batch("ROLLBACK").unwrap();
    assert_eq!(balance(&mut db, &[1]).unwrap(), 1);
    assert_eq!(count(&db, "ad_skip_opportunities"), 0);
    assert_eq!(count(&db, "ad_skip_ticket_redemptions"), 0);
}

#[test]
fn free_and_already_resolved_opportunities_never_charge() {
    let mut db = funded(1);
    let free = redeem(
        &mut db,
        &[1],
        &request("request-000000001", "cycle:1"),
        NOW,
        ALLOWED,
        |_, _| Ok(AdSkipEligibility::Free),
        unreachable_resolve,
    )
    .unwrap();
    assert_eq!(
        (free.resolution, free.consumed, free.balance),
        (AdSkipRedemptionResolution::Free, 0, 1)
    );
    // A free answer is not an opportunity resolution: a later ad can still settle it.
    assert!(matches!(
        claim_opportunity(
            &mut db,
            &[1],
            "generation_continue",
            "cycle:1",
            AdOpportunityResolution::Ad,
            "ad-session-1",
            NOW
        )
        .unwrap(),
        AdOpportunityClaim::Claimed(_)
    ));
    let late = redeem(
        &mut db,
        &[1],
        &request("request-000000002", "cycle:1"),
        NOW,
        ALLOWED,
        unreachable_evaluate,
        unreachable_resolve,
    )
    .unwrap();
    assert_eq!(late.resolution, AdSkipRedemptionResolution::AlreadyResolved);
    assert_eq!(late.consumed, 0);
    let opportunity = late.opportunity.clone().unwrap();
    assert_eq!(opportunity.resolution, AdOpportunityResolution::Ad);
    assert_eq!(opportunity.reference, "ad-session-1");
    assert_eq!(
        find_redemption(&mut db, &[1], "request-000000002")
            .unwrap()
            .unwrap()
            .opportunity,
        Some(opportunity)
    );
    assert_eq!(balance(&mut db, &[1]).unwrap(), 1);
}

#[test]
fn ticket_and_ad_paths_resolve_one_opportunity_once() {
    let mut db = funded(2);
    let first = redeem(
        &mut db,
        &[1],
        &request("request-000000001", "cycle:7"),
        NOW,
        ALLOWED,
        due,
        advanced,
    )
    .unwrap();
    // A different request for the same prompt, such as a lost request ID, is free.
    let second = redeem(
        &mut db,
        &[1],
        &request("request-000000002", "cycle:7"),
        NOW,
        ALLOWED,
        unreachable_evaluate,
        unreachable_resolve,
    )
    .unwrap();
    assert_eq!(
        second.resolution,
        AdSkipRedemptionResolution::AlreadyResolved
    );
    assert_eq!(
        second.opportunity.as_ref().unwrap().reference,
        first.receipt_id
    );
    // A late ad callback must not open a new ad interval.
    let late_ad = claim_opportunity(
        &mut db,
        &[1],
        "generation_continue",
        "cycle:7",
        AdOpportunityResolution::Ad,
        "ad-session-9",
        NOW + 1,
    )
    .unwrap();
    assert!(matches!(
        late_ad,
        AdOpportunityClaim::AlreadyResolved(AdOpportunity {
            resolution: AdOpportunityResolution::Ticket,
            ..
        })
    ));
    assert_eq!(balance(&mut db, &[1]).unwrap(), 1);
}

#[test]
fn one_ticket_cannot_pay_for_two_opportunities() {
    let mut db = funded(1);
    redeem(
        &mut db,
        &[1],
        &request("request-000000001", "cycle:1"),
        NOW,
        ALLOWED,
        due,
        advanced,
    )
    .unwrap();
    let error = redeem(
        &mut db,
        &[1],
        &request("request-000000002", "cycle:2"),
        NOW,
        ALLOWED,
        due,
        unreachable_resolve,
    )
    .unwrap_err();
    assert_eq!(error.code, "AD_SKIP_INSUFFICIENT_BALANCE");
    assert_eq!(balance(&mut db, &[1]).unwrap(), 0);
}

#[test]
fn sql_constraints_back_up_single_charge_and_non_negative_balance() {
    let mut db = funded(1);
    redeem(
        &mut db,
        &[1],
        &request("request-000000001", "cycle:1"),
        NOW,
        ALLOWED,
        due,
        advanced,
    )
    .unwrap();
    assert!(
        db.execute_batch(
            "INSERT INTO ad_skip_ticket_redemptions
            (id,user_id,request_id,placement,opportunity_key,context,resolution,consumed,balance_after,created_at)
            VALUES (printf('%048d',1),X'01','request-000000099','generation_continue','cycle:1','','TICKET',1,0,1)"
        )
        .is_err()
    );
    assert!(
        db.execute_batch("UPDATE ad_skip_ticket_wallets SET balance=balance-1")
            .is_err()
    );
    assert_eq!(
        db.execute_rows(WALLET_DEBIT, &[Value::Blob(vec![1]), Value::Integer(NOW)])
            .unwrap(),
        0
    );
}

#[test]
fn invalid_requests_and_ticket_claims_are_rejected() {
    let mut db = funded(1);
    let mut bad = vec![
        request("short", "cycle:1"),
        request("request-000000001", ""),
        request("request-000000001", "cycle 1"),
    ];
    let mut context = request("request-000000001", "cycle:1");
    context.context = "user@example.com";
    bad.push(context);
    for invalid in bad {
        assert_eq!(
            redeem(
                &mut db,
                &[1],
                &invalid,
                NOW,
                ALLOWED,
                unreachable_evaluate,
                unreachable_resolve
            )
            .unwrap_err()
            .code,
            "INVALID_AD_SKIP_REQUEST"
        );
    }
    assert!(
        claim_opportunity(
            &mut db,
            &[1],
            "generation_continue",
            "cycle:1",
            AdOpportunityResolution::Ad,
            "bad ref",
            NOW
        )
        .is_err()
    );
    assert_eq!(balance(&mut db, &[1]).unwrap(), 1);
}
