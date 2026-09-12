//! Disposable compatibility fixture. Never deploy this guest to a consumer service.
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use serde_json::{Value as JsonValue, json};
use trailbase_guest_common::{
    db, responses, toss_identity_store::TOSS_IDENTITY_REVOKED_SEALED_TOMBSTONE,
};
use trailbase_toss_identity::{
    TossIdentityKeyRing,
    reseal::{IdentityCiphertextTable, reseal_identity_batch_tx},
    seal_toss_user_key, toss_user_key_hmac,
};
use trailbase_wasm::db::Value;
use trailbase_wasm::http::{HttpRoute, Request, routing};
use trailbase_wasm::{Guest, export};
struct KeyRingSmoke;
impl Guest for KeyRingSmoke {
    fn http_handlers() -> Vec<HttpRoute> {
        vec![routing::post(
            "/kit-smoke/keyring",
            async |req| match probe(req) {
                Ok(value) => responses::ok(value),
                Err(error) => responses::error(error),
            },
        )]
    }
}
export!(KeyRingSmoke);
fn probe(req: Request) -> responses::ApiResult<JsonValue> {
    let user = req
        .user()
        .ok_or_else(|| responses::unauthorized("AUTH_REQUIRED", "authentication required"))?;
    if req.header("CSRF-Token").and_then(|h| h.to_str().ok()) != Some(user.csrf_token.as_str()) {
        return Err(responses::forbidden("CSRF_REQUIRED", "csrf required"));
    }
    let principal = URL_SAFE_NO_PAD
        .decode(user.id.trim_end_matches('='))
        .map_err(|_| responses::internal("invalid fixture principal"))?;
    // Public synthetic fixture keys, not secrets or production configuration.
    let old_key = "00".repeat(32);
    let new_key = "11".repeat(32);
    let ring =
        TossIdentityKeyRing::new("new", &[("old", &old_key), ("new", &new_key)], Some("old"))
            .map_err(responses::internal)?;
    let old_writer =
        TossIdentityKeyRing::new("old", &[("old", &old_key)], None).map_err(responses::internal)?;
    let plaintext = "synthetic-identity";
    let hmac =
        toss_user_key_hmac("synthetic-hmac-secret", plaintext).map_err(responses::internal)?;
    let legacy = seal_toss_user_key(&old_key, plaintext).map_err(responses::internal)?;
    let old_v2 = old_writer.seal(plaintext).map_err(responses::internal)?;
    let legacy_readable = ring.unseal(&legacy).map_err(responses::internal)? == plaintext;
    let old_v2_readable = ring.unseal(&old_v2).map_err(responses::internal)? == plaintext;
    let mut tx = db::tx()?;
    for (id, lookup, sealed, status) in [
        ("crypto-legacy", hmac.as_str(), legacy.as_str(), "ACTIVE"),
        ("crypto-v2", "fixture-v2-hmac", old_v2.as_str(), "ACTIVE"),
        (
            "crypto-erased",
            "fixture-erased-hmac",
            TOSS_IDENTITY_REVOKED_SEALED_TOMBSTONE,
            "REVOKED",
        ),
    ] {
        db::tx_execute(
            &mut tx,
            "INSERT INTO toss_identities (id,\"user\",toss_user_key_hmac,toss_user_key_sealed,referrer,status,linked_at,last_seen_at,created_at,updated_at) VALUES (?1,?2,?3,?4,'DEFAULT',?5,1,2,3,4)",
            &[
                Value::Text(id.into()),
                Value::Blob(principal.clone()),
                Value::Text(lookup.into()),
                Value::Text(sealed.into()),
                Value::Text(status.into()),
            ],
        )?;
    }
    let first = reseal_identity_batch_tx(&mut tx, IdentityCiphertextTable::Toss, &ring, None, 50)?;
    db::tx_execute(
        &mut tx,
        "INSERT INTO smoke_reseal_cursor VALUES (1,?1,?2)",
        &[
            first
                .next_cursor
                .clone()
                .map(Value::Text)
                .unwrap_or(Value::Null),
            Value::Integer(i64::from(first.complete)),
        ],
    )?;
    db::tx_commit(&mut tx)?;
    let mut tx = db::tx()?;
    let replay = reseal_identity_batch_tx(&mut tx, IdentityCiphertextTable::Toss, &ring, None, 50)?;
    let rows = db::tx_query(
        &mut tx,
        "SELECT toss_user_key_hmac,toss_user_key_sealed,updated_at FROM toss_identities WHERE id='crypto-legacy'",
        &[],
    )?;
    let sealed = db::text(&rows[0][1], "sealed")?;
    let second = db::tx_query(
        &mut tx,
        "SELECT toss_user_key_sealed FROM toss_identities WHERE id='crypto-v2'",
        &[],
    )?;
    let second_sealed = db::text(&second[0][0], "sealed")?;
    let distinct_nonces = sealed.starts_with("v2.new.")
        && second_sealed.starts_with("v2.new.")
        && matches!((sealed.split('.').nth(2), second_sealed.split('.').nth(2)),
            (Some(first), Some(second)) if first != second);
    let cursor = db::tx_query(
        &mut tx,
        "SELECT cursor,complete FROM smoke_reseal_cursor WHERE id=1",
        &[],
    )?;
    let tombstone = db::tx_query(
        &mut tx,
        "SELECT toss_user_key_sealed FROM toss_identities WHERE id='crypto-erased'",
        &[],
    )?;
    db::tx_commit(&mut tx)?;
    Ok(
        json!({"legacyReadable":legacy_readable,"oldV2Readable":old_v2_readable,
        "rewritten":first.rewritten,"replayNoop":replay.rewritten==0,
        "hmacUnchanged":db::text(&rows[0][0],"hmac")?==hmac,
        "timestampUnchanged":db::integer(&rows[0][2],"updated_at")?==4,
        "currentReadable":ring.unseal(&sealed).map_err(responses::internal)?==plaintext && ring.unseal(&second_sealed).map_err(responses::internal)?==plaintext,
        "distinctNonces":distinct_nonces,
        "cursorCommitted":db::nullable_text(&cursor[0][0])?==first.next_cursor && db::integer(&cursor[0][1],"complete")?==1,
        "tombstonePreserved":db::text(&tombstone[0][0],"tombstone")?==TOSS_IDENTITY_REVOKED_SEALED_TOMBSTONE}),
    )
}
