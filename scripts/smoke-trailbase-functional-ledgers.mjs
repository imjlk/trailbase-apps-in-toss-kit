#!/usr/bin/env bun

import assert from "node:assert/strict";
import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const templateDir = path.join(root, "templates", "trailbase", "sql");
const templates = [
  "operation_policies.sql",
  "app_reward_attempts.sql",
  "message_templates.sql",
  "notification_template_agreements.sql",
  "message_outbox.core.sql",
  "message_outbox_attempts.sql",
  "promotion_campaigns.sql",
  "promotion_reward_ledger.sql",
  "iap_orders.sql",
  "iap_subscriptions.sql",
  "anonymous_identities.sql",
  "message_outbox_recipients.migration.sql",
  "promotion_reward_recipients.sql",
];

const db = new Database(":memory:");

try {
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("CREATE TABLE _user (id BLOB PRIMARY KEY) STRICT");

  for (const template of templates) {
    const sql = readFileSync(path.join(templateDir, template), "utf8");
    assertNoForbiddenFunctionalLedgerSql(template, sql);
    db.exec(sql);
  }

  verifySchema();
  verifySampleRows();

  console.log(
    JSON.stringify(
      {
        ok: true,
        database: "main",
        tables: [
          "message_templates",
          "notification_template_agreements",
          "message_outbox",
          "message_outbox_attempts",
          "promotion_campaigns",
          "promotion_reward_ledger",
          "iap_orders",
          "operation_policies",
          "app_reward_attempts",
          "app_reward_grants",
        ],
        checkedIndexes: [
          "idx_message_outbox_ready_dispatch",
          "idx_message_outbox_attempts_expiry",
          "idx_notification_template_agreements_template_status",
          "idx_promotion_campaigns_active_feature",
          "idx_promotion_campaigns_active_feature_window",
          "idx_promotion_reward_ledger_campaign_status",
          "idx_iap_orders_product_status",
          "idx_app_reward_attempts_owner_placement",
        ],
        sampleRows: {
          messageTemplates: countRows("message_templates"),
          notificationTemplateAgreements: countRows("notification_template_agreements"),
          messageOutbox: countRows("message_outbox"),
          promotionCampaigns: countRows("promotion_campaigns"),
          promotionRewardLedger: countRows("promotion_reward_ledger"),
          iapOrders: countRows("iap_orders"),
          operationPolicies: countRows("operation_policies"),
          appRewardAttempts: countRows("app_reward_attempts"),
          appRewardGrants: countRows("app_reward_grants"),
        },
      },
      null,
      2,
    ),
  );
} finally {
  db.close();
}

function verifySchema() {
  assertTable("operation_policies");
  const feature = db.query("PRAGMA table_info(operation_policies)").all().find(row => row.name === "feature");
  if (feature?.pk !== 1) throw new Error("operation feature must be the primary key");
  assertTable("app_reward_attempts");
  assertTable("app_reward_grants");
  assertIndex("app_reward_attempts", "idx_app_reward_attempts_owner_placement");
  assertTable("iap_subscription_events");
  assertTable("iap_subscription_entitlements");
  assertTable("anonymous_identities");
  assertTable("promotion_reward_recipients");
  assertTable("message_outbox_attempts");
  assertIndex("message_outbox_attempts", "idx_message_outbox_attempts_expiry");
  for (const table of [
    "message_templates",
    "notification_template_agreements",
    "message_outbox",
    "promotion_campaigns",
    "promotion_reward_ledger",
    "iap_orders",
  ]) {
    assertTable(table);
  }

  assertIndex("message_outbox", "idx_message_outbox_ready_dispatch");
  assertIndex(
    "notification_template_agreements",
    "idx_notification_template_agreements_template_status",
  );
  assertIndex("promotion_campaigns", "idx_promotion_campaigns_active_feature");
  assertIndex("promotion_campaigns", "idx_promotion_campaigns_active_feature_window");
  assertIndex("promotion_reward_ledger", "idx_promotion_reward_ledger_campaign_status");
  assertIndex("iap_orders", "idx_iap_orders_product_status");

  const analyticsTables = db
    .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'analytics%'")
    .all();
  if (analyticsTables.length > 0) {
    throw new Error(`functional ledger smoke created analytics tables: ${joinNames(analyticsTables)}`);
  }
}

function verifySampleRows() {
  const userId = new Uint8Array([1, 2, 3, 4]);
  db.query("INSERT INTO _user (id) VALUES (?1)").run(userId);
  db.exec("INSERT INTO operation_policies VALUES ('iap',1,0,0,1,100,200)");
  const attempt = "a".repeat(48);
  db.query("INSERT INTO app_reward_attempts VALUES (?1,?2,'daily','AD','v1','coin',10,100,1100)").run(attempt, userId);
  db.query("INSERT INTO app_reward_grants VALUES (?1,200)").run(attempt);
  assert.equal(db.query("INSERT OR IGNORE INTO app_reward_grants VALUES (?1,201)").run(attempt).changes, 0);
  assert.equal(db.query("SELECT sum(a.reward_amount) AS credits FROM app_reward_grants g JOIN app_reward_attempts a ON a.id=g.attempt_id").get().credits, 10);
  db.query(
    `INSERT INTO message_templates (
      template_code, purpose, status, requires_agreement, agreement_template_code,
      cooldown_ms, created_at, updated_at
    )
    VALUES (?1, 'FUNCTIONAL', 'APPROVED', 1, ?2, 60000, ?3, ?3)`,
  ).run("daily-result", "daily-agreement", 1000);
  db.query(
    `INSERT INTO notification_template_agreements (
      id, user_id, template_code, status, source, last_result, created_at, updated_at
    )
    VALUES ('agreement-1', ?1, 'daily-agreement', 'OPTED_IN', 'smoke', 'newAgreement', ?2, ?2)`,
  ).run(userId, 1001);
  db.query(
    `INSERT INTO message_outbox (
      id, user_id, toss_user_key_hmac, toss_user_key_sealed, purpose, template_code,
      payload_json, idempotency_key, provider, provider_request_id, not_before_at, created_at,
      updated_at
    )
    VALUES (
      'message-1', ?1, 'hmac-1', 'sealed-1', 'FUNCTIONAL', 'daily-result',
      '{"kind":"smoke"}', 'message-idem-1', 'TOSS_SMART_MESSAGE', 'message-request-1',
      ?2, ?2, ?2
    )`,
  ).run(userId, 1002);
  db.query(
    `INSERT INTO promotion_campaigns (
      id, feature_key, provider, provider_promotion_code, reward_amount, status,
      starts_at, ends_at, budget_limit_amount, created_at, updated_at
    )
    VALUES (
      'campaign-1', 'daily-checkin', 'TOSS', 'provider-promotion-code', 10, 'ACTIVE',
      900, 2000, 1000, ?1, ?1
    )`,
  ).run(1003);
  db.query(
    `INSERT INTO promotion_reward_ledger (
      id, user_id, campaign_id, source_type, source_id, reward_amount, status,
      provider, provider_request_id, requested_at, created_at, updated_at
    )
    VALUES (
      'reward-1', ?1, 'campaign-1', 'checkin', 'checkin-1', 10, 'pending',
      'TOSS', 'promotion-request-1', ?2, ?2, ?2
    )`,
  ).run(userId, 1004);
  db.query(
    `INSERT INTO iap_orders (
      order_id, user_id, toss_user_key_hmac, product_id, status, provider_status,
      created_at, updated_at
    )
    VALUES ('order-1', ?1, 'hmac-1', 'coin-pack', 'PENDING', 'IN_PROGRESS', ?2, ?2)`,
  ).run(userId, 1005);
}

function assertNoForbiddenFunctionalLedgerSql(template, sql) {
  const lower = sql.toLowerCase();
  const forbidden = [
    "analytics.",
    " mtls_proxy_token",
    " proxy_token",
    " raw_toss_user_key",
    " toss_user_key text",
  ];
  for (const marker of forbidden) {
    if (lower.includes(marker)) {
      throw new Error(`${template} contains forbidden functional ledger SQL marker: ${marker}`);
    }
  }
}

function assertTable(name) {
  const row = db
    .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?1")
    .get(name);
  if (!row) {
    throw new Error(`missing table: ${name}`);
  }
}

function assertIndex(table, indexName) {
  const indexes = db.query(`PRAGMA index_list('${table}')`).all();
  if (!indexes.some((row) => row.name === indexName)) {
    throw new Error(`missing index ${indexName} on ${table}; found ${joinNames(indexes)}`);
  }
}

function countRows(table) {
  return db.query(`SELECT COUNT(*) AS count FROM ${table}`).get().count;
}

function joinNames(rows) {
  return rows.map((row) => row.name).sort().join(", ");
}
