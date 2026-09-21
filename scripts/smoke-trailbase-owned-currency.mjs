#!/usr/bin/env bun

import assert from "node:assert/strict";
import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const sqlDir = path.join(root, "templates", "trailbase", "sql");
const editorDir = path.join(root, "templates", "trailbase", "sql-editor");
const db = new Database(":memory:");
const X01 = new Uint8Array([1]);

try {
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("CREATE TABLE _user (id BLOB PRIMARY KEY) STRICT");
  db.exec("INSERT INTO _user VALUES (X'01')");
  db.exec(readFileSync(path.join(sqlDir, "owned_currency_events.sql"), "utf8"));

  const insert = db.query(`INSERT INTO owned_currency_events
    (id, user_id, currency_code, unit_code, event_type, quantity, source_type,
     source_id, idempotency_key, policy_version, conversion_group_id,
     exchange_id, valuation_amount, valuation_currency_code, occurred_at,
     created_at, metadata_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const add = values => insert.run(...values);
  add(["gold-issue", X01, "gold_dust", "mg", "ISSUE", 100, "daily-mission", "m-1", "event:gold-issue", "v1", null, null, null, null, 1000, 1000, "{}"]);
  add(["gold-spend", X01, "gold_dust", "mg", "SPEND", -20, "furnace", "f-1", "event:gold-spend", "v1", null, null, null, null, 2000, 2000, "{}"]);
  add(["gold-convert-out", X01, "gold_dust", "mg", "CONVERT_OUT", -30, "refine", "r-1", "event:gold-convert-out", "v1", "conversion-1", null, null, null, 3000, 3000, "{}"]);
  add(["bar-convert-in", X01, "gold_bar", "mg", "CONVERT_IN", 3, "refine", "r-1", "event:bar-convert-in", "v1", "conversion-1", null, null, null, 3000, 3000, "{}"]);
  add(["gold-exchange", X01, "gold_dust", "mg", "EXCHANGE", -10, "promotion", "p-1", "event:gold-exchange", "v1", null, "exchange-1", 50, "TOSS_POINT", 4000, 4000, "{}"]);
  add(["gold-expire", X01, "gold_dust", "mg", "EXPIRE", -5, "expiry", "x-1", "event:gold-expire", "v1", null, null, null, null, 5000, 5000, "{}"]);
  add(["gold-adjust", X01, "gold_dust", "mg", "ADJUSTMENT", 2, "operator", "a-1", "event:gold-adjust", "v2", null, null, null, null, 6000, 6000, "{}"]);
  add(["star-issue", X01, "stars", "count", "ISSUE", 5, "vote", "v-1", "event:star-issue", "v1", null, null, null, null, 1500, 1500, "{}"]);

  const queries = loadQueries(readFileSync(path.join(editorDir, "owned-currency-report.sql"), "utf8"));
  const monthly = db.query(withTestWindow(queries.monthly_summary, 1000, 6000)).all();
  assert.deepEqual(monthly, [
    {
      currency_code: "gold_bar",
      unit_code: "mg",
      issued_quantity: 0,
      spent_quantity: 0,
      converted_out_quantity: 0,
      converted_in_quantity: 3,
      exchanged_quantity: 0,
      expired_quantity: 0,
      adjustment_credit_quantity: 0,
      adjustment_debit_quantity: 0,
      event_count: 1,
    },
    {
      currency_code: "gold_dust",
      unit_code: "mg",
      issued_quantity: 100,
      spent_quantity: 20,
      converted_out_quantity: 30,
      converted_in_quantity: 0,
      exchanged_quantity: 10,
      expired_quantity: 5,
      adjustment_credit_quantity: 0,
      adjustment_debit_quantity: 0,
      event_count: 5,
    },
    {
      currency_code: "stars",
      unit_code: "count",
      issued_quantity: 5,
      spent_quantity: 0,
      converted_out_quantity: 0,
      converted_in_quantity: 0,
      exchanged_quantity: 0,
      expired_quantity: 0,
      adjustment_credit_quantity: 0,
      adjustment_debit_quantity: 0,
      event_count: 1,
    },
  ]);

  const balances = db.query(withTestAsOf(queries.balance_as_of, 7000)).all();
  assert.deepEqual(balances, [
    { currency_code: "gold_bar", unit_code: "mg", balance_quantity: 3, event_count: 1 },
    { currency_code: "gold_dust", unit_code: "mg", balance_quantity: 37, event_count: 6 },
    { currency_code: "stars", unit_code: "count", balance_quantity: 5, event_count: 1 },
  ]);

  const policy = db.query(withTestWindow(queries.policy_breakdown, 1000, 7000)).all();
  assert.equal(policy.find(row => row.currency_code === "gold_dust" && row.policy_version === "v1").recorded_valuation_amount, 50);
  assert.equal(policy.find(row => row.currency_code === "gold_dust" && row.policy_version === "v2").issued_quantity, 0);

  assert.deepEqual(db.query(queries.duplicate_source_check).all(), []);
  assert.throws(() => add(["duplicate-idempotency", X01, "stars", "count", "ISSUE", 1, "vote", "v-2", "event:star-issue", "v1", null, null, null, null, 7000, 7000, "{}"]));

  db.query("DELETE FROM _user WHERE id = X'01'").run();
  assert.equal(db.query("SELECT user_id FROM owned_currency_events WHERE id = 'gold-issue'").get().user_id, null);

  console.log(JSON.stringify({
    ok: true,
    table: "owned_currency_events",
    queries: Object.keys(queries),
    rowCount: db.query("SELECT count(*) AS count FROM owned_currency_events").get().count,
  }, null, 2));
} finally {
  db.close();
}

function loadQueries(sql) {
  return Object.fromEntries([...sql.matchAll(/-- Query: ([^\n]+)\n([\s\S]*?);\s*(?=-- Query:|$)/g)]
    .map(([, name, statement]) => [name.trim(), statement.trim()]));
}

function withTestWindow(sql, start, end) {
  return sql.replace("1788192000000", String(start)).replace("1790870400000", String(end));
}

function withTestAsOf(sql, asOf) {
  return sql.replace("1790870400000", String(asOf));
}
