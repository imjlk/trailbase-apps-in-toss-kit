//! Explicit recipient types for private message dispatch. Apply the anonymous
//! identity and outbox-recipient migrations before using these helpers.
use crate::apps_in_toss_messages::{
    MessageDispatchGate, MessageOutboxRecord, MessagePurpose,
    message_dispatch_gate_for_trailbase_user_tx, message_outbox_record_from_row,
    remove_raw_recipient_fields,
};
use crate::responses::{ApiResult, bad_request, internal};
use crate::{db, toss_identity_store};
use serde_json::{Value as JsonValue, json};
use trailbase_wasm::db::{Transaction, Value};

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum ProxyRecipientKind {
    TossUserKey,
    AnonymousKey,
}

// Backend-only secrets; deliberately not Debug/Serialize.
pub struct StoredProxyRecipient {
    pub kind: ProxyRecipientKind,
    pub hmac: String,
    pub sealed: String,
}
pub enum ProxyRecipient<'a> {
    TossUserKey(&'a str),
    AnonymousKey(&'a str),
}

pub fn payload_with_recipient(
    mut payload: JsonValue,
    recipient: ProxyRecipient<'_>,
) -> ApiResult<JsonValue> {
    remove_raw_recipient_fields(&mut payload);
    let object = payload
        .as_object_mut()
        .ok_or_else(|| bad_request("INVALID_PROXY_PAYLOAD", "payload must be an object"))?;
    let (field, key) = match recipient {
        ProxyRecipient::TossUserKey(key) => ("tossUserKey", key),
        ProxyRecipient::AnonymousKey(key) => ("anonKey", key),
    };
    if key.trim().is_empty() {
        return Err(bad_request(
            "INVALID_MESSAGE_RECIPIENT",
            "recipient key is empty",
        ));
    }
    object.insert(field.into(), json!(key));
    Ok(payload)
}

pub struct AnonymousMessageOutboxEnqueueInput<'a> {
    pub id: Option<&'a str>,
    pub user: &'a [u8],
    pub anonymous_hash_hmac: &'a str,
    pub campaign_id: Option<&'a str>,
    pub purpose: MessagePurpose,
    pub template_code: &'a str,
    pub payload: JsonValue,
    pub idempotency_key: &'a str,
    pub provider_request_id: &'a str,
    pub not_before_at: i64,
    pub now: i64,
}

const ENQUEUE_ANONYMOUS: &str = "INSERT INTO message_outbox
    (id,user_id,toss_user_key_hmac,recipient_kind,anonymous_hash_hmac,campaign_id,purpose,
     template_code,payload_json,idempotency_key,provider_request_id,not_before_at,created_at,updated_at)
    VALUES (COALESCE(?1,lower(hex(randomblob(16)))),?2,'','ANONYMOUS_KEY',?3,?4,?5,?6,?7,?8,?9,?10,?11,?11)
    ON CONFLICT(idempotency_key) DO UPDATE SET updated_at=message_outbox.updated_at
    WHERE message_outbox.user_id=excluded.user_id AND message_outbox.recipient_kind='ANONYMOUS_KEY'
      AND message_outbox.anonymous_hash_hmac=excluded.anonymous_hash_hmac
    RETURNING id,user_id,toss_user_key_hmac,toss_user_key_sealed,campaign_id,purpose,template_code,
      payload_json,idempotency_key,status,provider,provider_request_id,provider_status,attempts,
      not_before_at,locked_at,created_at,updated_at";

pub fn enqueue_anonymous_message_outbox_tx(
    tx: &mut Transaction,
    input: AnonymousMessageOutboxEnqueueInput<'_>,
) -> ApiResult<MessageOutboxRecord> {
    let params = anonymous_enqueue_params(input)?;
    let rows = db::tx_query(tx, ENQUEUE_ANONYMOUS, &params)?;
    rows.first()
        .map(|row| message_outbox_record_from_row(row))
        .transpose()?
        .ok_or_else(|| {
            bad_request(
                "MESSAGE_IDEMPOTENCY_CONFLICT",
                "message identity does not match existing request",
            )
        })
}

fn anonymous_enqueue_params(
    mut input: AnonymousMessageOutboxEnqueueInput<'_>,
) -> ApiResult<Vec<Value>> {
    if input.user.is_empty()
        || !input.payload.is_object()
        || [
            input.anonymous_hash_hmac,
            input.template_code,
            input.idempotency_key,
            input.provider_request_id,
        ]
        .iter()
        .any(|s| s.trim().is_empty())
    {
        return Err(bad_request(
            "INVALID_MESSAGE_OUTBOX",
            "user, identity, message codes and object payload are required",
        ));
    }
    remove_raw_recipient_fields(&mut input.payload);
    Ok(vec![
        input
            .id
            .map(str::trim)
            .filter(|id| !id.is_empty())
            .map(|id| Value::Text(id.to_owned()))
            .unwrap_or(Value::Null),
        Value::Blob(input.user.to_vec()),
        Value::Text(input.anonymous_hash_hmac.trim().to_owned()),
        input
            .campaign_id
            .map(str::trim)
            .filter(|id| !id.is_empty())
            .map(|id| Value::Text(id.to_owned()))
            .unwrap_or(Value::Null),
        Value::Text(input.purpose.as_str().into()),
        Value::Text(input.template_code.trim().to_owned()),
        Value::Text(input.payload.to_string()),
        Value::Text(input.idempotency_key.trim().to_owned()),
        Value::Text(input.provider_request_id.trim().to_owned()),
        Value::Integer(input.not_before_at),
        Value::Integer(input.now),
    ])
}

/// Use this same gate for both recipient types immediately before dispatch.
pub fn message_recipient_dispatch_gate_tx(
    tx: &mut Transaction,
    outbox: &MessageOutboxRecord,
) -> ApiResult<MessageDispatchGate> {
    message_dispatch_gate_for_trailbase_user_tx(
        tx,
        &outbox.user_id,
        outbox.purpose,
        &outbox.template_code,
    )
}

pub fn message_recipient_for_dispatch_tx(
    tx: &mut Transaction,
    outbox: &MessageOutboxRecord,
) -> ApiResult<StoredProxyRecipient> {
    let rows = db::tx_query(
        tx,
        "SELECT recipient_kind,anonymous_hash_hmac FROM message_outbox WHERE id=?1 AND user_id=?2",
        &[
            Value::Text(outbox.id.clone()),
            Value::Blob(outbox.user_id.clone()),
        ],
    )?;
    let row = rows
        .first()
        .ok_or_else(|| internal("Message recipient is unavailable"))?;
    match db::text(&row[0], "recipient_kind")?.as_str() {
        "ANONYMOUS_KEY" => {
            let hmac = db::text(&row[1], "anonymous_hash_hmac")?;
            let rows = db::tx_query(
                tx,
                "SELECT anonymous_key_sealed FROM anonymous_identities
                WHERE anonymous_hash_hmac=?1 AND user_id=?2 AND revoked_at IS NULL",
                &[
                    Value::Text(hmac.clone()),
                    Value::Blob(outbox.user_id.clone()),
                ],
            )?;
            let row = rows
                .first()
                .ok_or_else(|| internal("Anonymous message identity is unavailable"))?;
            Ok(StoredProxyRecipient {
                kind: ProxyRecipientKind::AnonymousKey,
                hmac,
                sealed: db::text(&row[0], "anonymous_key_sealed")?,
            })
        }
        "TOSS_USER_KEY" => {
            let identity = toss_identity_store::require_active_toss_identity_for_trailbase_user_tx(
                tx,
                &outbox.user_id,
            )?;
            if identity.toss_user_key_hmac != outbox.toss_user_key_hmac {
                return Err(internal(
                    "Message recipient no longer matches the linked identity",
                ));
            }
            Ok(StoredProxyRecipient {
                kind: ProxyRecipientKind::TossUserKey,
                hmac: identity.toss_user_key_hmac,
                sealed: identity
                    .toss_user_key_sealed
                    .ok_or_else(|| internal("Message identity is unavailable"))?,
            })
        }
        _ => Err(internal("Unknown message recipient kind")),
    }
}

/// Bind a grant to the anonymous identity used when it was created. Later Toss
/// Login must not silently change the recipient used for execution-result.
pub fn bind_anonymous_promotion_recipient_tx(
    tx: &mut Transaction,
    reward_id: &str,
    user: &[u8],
    anonymous_hash_hmac: &str,
) -> ApiResult<()> {
    let changed = db::tx_execute(tx, "INSERT INTO promotion_reward_recipients (reward_id,anonymous_hash_hmac)
        SELECT r.id,a.anonymous_hash_hmac FROM promotion_reward_ledger r,anonymous_identities a
        WHERE r.id=?1 AND r.user_id=?2 AND a.user_id=?2 AND a.anonymous_hash_hmac=?3 AND a.revoked_at IS NULL
        ON CONFLICT(reward_id) DO UPDATE SET anonymous_hash_hmac=promotion_reward_recipients.anonymous_hash_hmac
        WHERE promotion_reward_recipients.anonymous_hash_hmac=excluded.anonymous_hash_hmac",
        &[Value::Text(reward_id.into()),Value::Blob(user.to_vec()),Value::Text(anonymous_hash_hmac.into())])?;
    if changed != 1 {
        return Err(bad_request(
            "PROMOTION_RECIPIENT_CONFLICT",
            "promotion recipient is unavailable or does not match",
        ));
    }
    Ok(())
}

pub fn anonymous_promotion_recipient_tx(
    tx: &mut Transaction,
    reward_id: &str,
    user: &[u8],
) -> ApiResult<StoredProxyRecipient> {
    let rows = db::tx_query(
        tx,
        "SELECT a.anonymous_hash_hmac,a.anonymous_key_sealed
        FROM promotion_reward_recipients p JOIN promotion_reward_ledger r ON r.id=p.reward_id
        JOIN anonymous_identities a ON a.anonymous_hash_hmac=p.anonymous_hash_hmac
        WHERE r.id=?1 AND r.user_id=?2 AND a.user_id=?2 AND a.revoked_at IS NULL",
        &[Value::Text(reward_id.into()), Value::Blob(user.to_vec())],
    )?;
    let row = rows
        .first()
        .ok_or_else(|| internal("Anonymous promotion identity is unavailable"))?;
    Ok(StoredProxyRecipient {
        kind: ProxyRecipientKind::AnonymousKey,
        hmac: db::text(&row[0], "anonymous_hash_hmac")?,
        sealed: db::text(&row[1], "anonymous_key_sealed")?,
    })
}

#[cfg(all(test, not(target_arch = "wasm32")))]
mod tests {
    use super::*;
    use crate::{
        anonymous_identity::UPSERT_IDENTITY,
        sql_test_support::{database, insert_outbox},
    };
    use rusqlite::params;

    #[test]
    fn additive_migration_preserves_login_rows_and_checks_anonymous_ownership() {
        let db = database();
        insert_outbox(&db, "legacy", "SENT", 1);
        db.execute_batch(include_str!(
            "../../../templates/trailbase/sql/anonymous_identities.sql"
        ))
        .unwrap();
        db.execute_batch(include_str!(
            "../../../templates/trailbase/sql/message_outbox_recipients.migration.sql"
        ))
        .unwrap();
        assert_eq!(
            db.query_row(
                "SELECT recipient_kind FROM message_outbox WHERE id='legacy'",
                [],
                |r| r.get::<_, String>(0)
            )
            .unwrap(),
            "TOSS_USER_KEY"
        );
        db.execute(UPSERT_IDENTITY, params!["anon-hmac", [1u8], "sealed", 1])
            .unwrap();
        let values = params![
            "anon",
            [1u8],
            "anon-hmac",
            Option::<String>::None,
            "FUNCTIONAL",
            "reminder",
            "{}",
            "idem",
            "request",
            1,
            1
        ];
        let mut stmt = db.prepare(ENQUEUE_ANONYMOUS).unwrap();
        assert_eq!(
            stmt.query(values)
                .unwrap()
                .next()
                .unwrap()
                .unwrap()
                .get::<_, String>(2)
                .unwrap(),
            ""
        );
        db.execute("INSERT INTO _user VALUES (X'02')", []).unwrap();
        assert!(
            db.execute(
                "UPDATE message_outbox SET user_id=X'02' WHERE id='anon'",
                []
            )
            .is_err()
        );
        assert_eq!(
            db.execute(
                UPSERT_IDENTITY,
                params!["anon-hmac", [2u8], "another-sealed", 2]
            )
            .unwrap(),
            0
        );
        db.execute("UPDATE anonymous_identities SET revoked_at=3", [])
            .unwrap();
        assert_eq!(
            db.execute(UPSERT_IDENTITY, params!["anon-hmac", [1u8], "sealed", 4])
                .unwrap(),
            0
        );
    }

    #[test]
    fn anonymous_enqueue_normalizes_template_and_idempotency_identifiers() {
        let db = database();
        db.execute_batch(include_str!(
            "../../../templates/trailbase/sql/anonymous_identities.sql"
        ))
        .unwrap();
        db.execute_batch(include_str!(
            "../../../templates/trailbase/sql/message_outbox_recipients.migration.sql"
        ))
        .unwrap();
        db.execute(UPSERT_IDENTITY, params!["anon-hmac", [1u8], "sealed", 1])
            .unwrap();
        for padded in [true, false] {
            let args = anonymous_enqueue_params(AnonymousMessageOutboxEnqueueInput {
                id: Some(if padded { " row " } else { "another-row" }),
                user: &[1],
                anonymous_hash_hmac: if padded { " anon-hmac " } else { "anon-hmac" },
                campaign_id: Some("  "),
                purpose: MessagePurpose::Functional,
                template_code: if padded { " reminder " } else { "reminder" },
                payload: json!({"tossUserKey":"raw-login","userKey":"raw-user","anonKey":"raw-anon","context":{"items":[{"anonKey":"nested-raw","label":"safe"}]}}),
                idempotency_key: if padded { " idem " } else { "idem" },
                provider_request_id: if padded { " request " } else { "request" },
                not_before_at: 1,
                now: 1,
            })
            .unwrap();
            let rows = crate::sql_test_support::query(&db, ENQUEUE_ANONYMOUS, &args);
            assert_eq!(rows[0][0], rusqlite::types::Value::Text("row".into()));
        }
        let payload: String = db
            .query_row("SELECT payload_json FROM message_outbox", [], |r| r.get(0))
            .unwrap();
        assert_eq!(
            serde_json::from_str::<JsonValue>(&payload).unwrap(),
            json!({"context":{"items":[{"label":"safe"}]}})
        );
        let row = db.query_row("SELECT template_code,idempotency_key,provider_request_id,campaign_id FROM message_outbox", [], |r|
            Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?,r.get::<_,Option<String>>(3)?))).unwrap();
        assert_eq!(
            row,
            ("reminder".into(), "idem".into(), "request".into(), None)
        );
        assert_eq!(
            db.query_row("SELECT count(*) FROM message_outbox", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            1
        );
    }

    #[test]
    fn payload_has_exactly_one_explicit_recipient() {
        let payload = payload_with_recipient(
            json!({"tossUserKey":"old","userKey":"old","context":{
                "anonKey":"old", "items":[{"userKey":"old","name":"Ada"}]
            }}),
            ProxyRecipient::AnonymousKey("anon"),
        )
        .unwrap();
        assert_eq!(
            payload,
            json!({"anonKey":"anon","context":{"items":[{"name":"Ada"}]}})
        );
    }
}
