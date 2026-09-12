//! Disposable compatibility fixture. Never install this component in production.
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use serde_json::{Value as JsonValue, json};
use trailbase_guest_common::{
    anonymous_identity, apps_in_toss_login, apps_in_toss_proxy, db, responses, trailbase_auth,
};
use trailbase_wasm::db::Value;
use trailbase_wasm::http::{HttpRoute, Request, Response, routing};
use trailbase_wasm::{Guest, export};

struct CompatSmoke;
impl Guest for CompatSmoke {
    fn http_handlers() -> Vec<HttpRoute> {
        vec![
            routing::get("/kit-smoke/ready", async |_| {
                responses::ok(json!({"ok":true}))
            }),
            routing::post("/kit-smoke/bootstrap", async |req| {
                respond(bootstrap(req).await)
            }),
            routing::get("/kit-smoke/private", async |req: Request| {
                match req.user() {
                    Some(user) => responses::ok(json!({"ok":true,"userId":user.id})),
                    None => responses::error(responses::unauthorized(
                        "AUTH_REQUIRED",
                        "authentication required",
                    )),
                }
            }),
            routing::post("/kit-smoke/write", async |req| respond(write(req))),
            routing::post("/kit-smoke/toss-login", async |_| {
                let result = apps_in_toss_proxy::toss_login_complete(
                    "http://kit-proxy:8787",
                    Some("dev-token"),
                    "dev-smoke",
                    &apps_in_toss_login::normalize_login_referrer("SANDBOX"),
                )
                .await;
                match result {
                    Ok(value) => {
                        responses::ok(json!({"ok":value.get("ok")==Some(&JsonValue::Bool(true))}))
                    }
                    Err(_) => responses::error(responses::internal("stub login failed")),
                }
            }),
        ]
    }
}
export!(CompatSmoke);

fn respond(result: responses::ApiResult<JsonValue>) -> Response {
    match result {
        Ok(value) => responses::ok(value),
        Err(error) => responses::error(error),
    }
}
async fn bootstrap(req: Request) -> responses::ApiResult<JsonValue> {
    let seed = req.query_param("seed").unwrap_or_else(|| "alpha".into());
    if !["alpha", "beta"].contains(&seed.as_str()) {
        return Err(responses::bad_request(
            "INVALID_SEED",
            "fixture seed required",
        ));
    }
    let verified = anonymous_identity::verify_anonymous_hash(
        "http://kit-proxy:8787",
        Some("dev-token"),
        &format!("ait:smoke-{seed}"),
    )
    .await
    .map_err(responses::internal)?;
    let hmac = verified
        .hmac("smoke-only-hmac")
        .map_err(responses::internal)?;
    let credentials =
        trailbase_auth::anonymous_auth_user_credentials(&hmac, "smoke-only-password-secret")?;
    let mut tx = db::tx()?;
    trailbase_auth::ensure_verified_auth_user_tx(&mut tx, &credentials)?;
    db::tx_commit(&mut tx)?;
    let tokens = trailbase_auth::login_auth_user("http://127.0.0.1:4000", &credentials).await?;
    serde_json::to_value(tokens).map_err(|_| responses::internal("serialize tokens"))
}
fn write(req: Request) -> responses::ApiResult<JsonValue> {
    let user = req
        .user()
        .ok_or_else(|| responses::unauthorized("AUTH_REQUIRED", "authentication required"))?;
    if req.header("CSRF-Token").and_then(|h| h.to_str().ok()) != Some(user.csrf_token.as_str()) {
        return Err(responses::forbidden("CSRF_REQUIRED", "csrf required"));
    }
    let user_id = URL_SAFE_NO_PAD
        .decode(user.id.trim_end_matches('='))
        .map_err(|_| responses::internal("invalid principal"))?;
    let id = req
        .query_param("id")
        .and_then(|v| v.parse::<i64>().ok())
        .unwrap_or(1);
    let mut tx = db::tx()?;
    match req.query_param("op").as_deref().unwrap_or("insert") {
        "insert" => {
            db::tx_execute(
                &mut tx,
                "INSERT INTO smoke_items(id,owner,value) VALUES (?1,?2,'initial')",
                &[Value::Integer(id), Value::Blob(user_id)],
            )?;
        }
        "update" => {
            db::tx_execute(
                &mut tx,
                "UPDATE smoke_items SET value='updated' WHERE id=?1 AND owner=?2",
                &[Value::Integer(id), Value::Blob(user_id)],
            )?;
        }
        "delete" => {
            db::tx_execute(
                &mut tx,
                "DELETE FROM smoke_items WHERE id=?1 AND owner=?2",
                &[Value::Integer(id), Value::Blob(user_id)],
            )?;
        }
        _ => {
            return Err(responses::bad_request(
                "INVALID_OPERATION",
                "unknown fixture operation",
            ));
        }
    }
    db::tx_commit(&mut tx)?;
    Ok(json!({"ok":true}))
}
