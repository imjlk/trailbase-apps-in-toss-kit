use serde_json::Value;
use std::collections::BTreeMap;
use trailbase_guest_common::{
    anonymous_identity::{ANONYMOUS_AUTH_CODE_EXCHANGE_PATH, ANONYMOUS_KEY_VERIFY_PATH},
    apps_in_toss_messages::parse_message_proxy_response,
    apps_in_toss_proxy::{
        IAP_ORDER_STATUS_PATH, PROMOTION_REWARD_EXECUTE_PATH, PROMOTION_REWARD_PREPARE_PATH,
        PROMOTION_REWARD_STATUS_PATH, SMART_MESSAGE_BULK_SEND_PATH, SMART_MESSAGE_SEND_PATH,
        TOSS_LOGIN_COMPLETE_PATH, TOSS_LOGIN_REMOVE_BY_USER_KEY_PATH,
    },
    iap_orders::normalize_iap_order_status_response,
    promotion_rewards::{promotion_ledger_status, promotion_reward_outcome_from_response},
};

fn fixtures() -> Value {
    serde_json::from_str(include_str!(
        "../../../fixtures/contracts/apps-in-toss.v1.json"
    ))
    .unwrap()
}

#[test]
fn iap_wire_contracts_preserve_status_and_verification_failures() {
    let data = fixtures();
    assert_eq!(data["schemaVersion"], 1);
    for case in data["iap"].as_array().unwrap() {
        let result = normalize_iap_order_status_response(&case["proxyResponse"]);
        assert_eq!(
            result.ledger_status.as_str(),
            case["ledgerStatus"].as_str().unwrap(),
            "{}",
            case["id"]
        );
        assert_eq!(
            result.grant_required,
            case["grantRequired"].as_bool().unwrap(),
            "{}",
            case["id"]
        );
        assert_eq!(
            result.terminal,
            case["terminal"].as_bool().unwrap(),
            "{}",
            case["id"]
        );
    }
}

#[test]
fn promotion_wire_contracts_do_not_turn_failure_into_grant() {
    for case in fixtures()["promotion"].as_array().unwrap() {
        let result = promotion_reward_outcome_from_response(&case["response"], "fixture-request");
        assert_eq!(
            result.provider_status,
            case["providerStatus"].as_str().unwrap(),
            "{}",
            case["id"]
        );
        assert_eq!(
            promotion_ledger_status(&result.provider_status),
            case["ledgerStatus"].as_str().unwrap(),
            "{}",
            case["id"]
        );
        if case["ledgerStatus"] != "success" {
            assert!(result.granted_at.is_none());
        }
    }
}

#[test]
fn message_wire_contracts_keep_partial_success_and_unknown_outcomes_distinct() {
    for case in fixtures()["message"].as_array().unwrap() {
        let result =
            parse_message_proxy_response(&case["proxyResponse"], "fixture-request", Some(100));
        assert_eq!(
            result.provider_status,
            case["providerStatus"].as_str().unwrap(),
            "{}",
            case["id"]
        );
        assert_eq!(
            result.is_sent(),
            case["isSent"].as_bool().unwrap(),
            "{}",
            case["id"]
        );
        if case["id"] == "partial-delivery" {
            assert_eq!(result.sent_inbox_count, Some(1));
            assert_eq!(result.sent_push_count, Some(0));
            assert_eq!(
                result.failures[0].reach_fail_reason.as_deref(),
                Some("FIXTURE_BLOCKED")
            );
        }
    }
}

#[test]
fn proxy_route_constants_match_shared_route_fixture() {
    // The proxy and @ait-kit/api-client are checked against the same rows,
    // so a Rust-only path edit cannot silently drift from the proxy routes.
    let rust_paths = BTreeMap::from([
        ("TOSS_LOGIN_COMPLETE_PATH", TOSS_LOGIN_COMPLETE_PATH),
        (
            "TOSS_LOGIN_REMOVE_BY_USER_KEY_PATH",
            TOSS_LOGIN_REMOVE_BY_USER_KEY_PATH,
        ),
        ("IAP_ORDER_STATUS_PATH", IAP_ORDER_STATUS_PATH),
        ("ANONYMOUS_KEY_VERIFY_PATH", ANONYMOUS_KEY_VERIFY_PATH),
        (
            "ANONYMOUS_AUTH_CODE_EXCHANGE_PATH",
            ANONYMOUS_AUTH_CODE_EXCHANGE_PATH,
        ),
        (
            "PROMOTION_REWARD_PREPARE_PATH",
            PROMOTION_REWARD_PREPARE_PATH,
        ),
        (
            "PROMOTION_REWARD_EXECUTE_PATH",
            PROMOTION_REWARD_EXECUTE_PATH,
        ),
        ("PROMOTION_REWARD_STATUS_PATH", PROMOTION_REWARD_STATUS_PATH),
        ("SMART_MESSAGE_SEND_PATH", SMART_MESSAGE_SEND_PATH),
        ("SMART_MESSAGE_BULK_SEND_PATH", SMART_MESSAGE_BULK_SEND_PATH),
    ]);
    let data = fixtures();
    let fixture_paths: BTreeMap<&str, &str> = data["routes"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|route| route.get("removed").is_none())
        .filter_map(|route| Some((route["rustConst"].as_str()?, route["path"].as_str()?)))
        .collect();
    assert_eq!(rust_paths, fixture_paths);
}
