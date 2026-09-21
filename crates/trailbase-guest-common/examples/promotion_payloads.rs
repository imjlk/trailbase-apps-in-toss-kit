//! Synthetic requests used by the Rust-to-proxy contract test; never reads real identities.
use serde_json::{Value, json};
use trailbase_guest_common::promotion_rewards::{
    PromotionGrantContext, PromotionRecipient, PromotionRewardRequest,
    promotion_reward_payload_for_recipient, promotion_reward_prepare_payload,
};

fn main() {
    let context = PromotionGrantContext {
        campaign_id: Some("fixture-campaign".into()),
        provider_promotion_code: Some("fixture-promotion".into()),
        reward_amount: 5,
        source: "daily-reward".into(),
    };
    let requests: Vec<Value> = [
        (
            "anonymous",
            PromotionRecipient::AnonymousKey("fixture-anonymous"),
        ),
        ("login", PromotionRecipient::TossUserKey("fixture-login")),
    ]
    .into_iter()
    .map(|(kind, recipient)| {
        // The fake provider returns this key. Production callers persist the
        // returned key and recipient before building execution/status requests.
        let key = format!("fixture-key-{kind}");
        let prepare = promotion_reward_prepare_payload(recipient).unwrap();
        let execute = promotion_reward_payload_for_recipient(PromotionRewardRequest {
            provider_request_id: "fixture-request",
            provider_transaction_key: &key,
            promotion: &context,
            requested_at: 100,
            recipient,
            eligibility_id: None,
            user_id: None,
            source_type: Some("daily-reward"),
            source_id: Some(json!("fixture-day")),
        })
        .unwrap();
        json!({ "kind": kind, "prepare": prepare, "execute": execute, "status": execute })
    })
    .collect();
    println!("{}", json!(requests));
}
