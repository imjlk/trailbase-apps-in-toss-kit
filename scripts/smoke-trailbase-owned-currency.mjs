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
  db.exec(readFileSync(path.join(sqlDir, "owned_currency_policies.sql"), "utf8"));
  db.query(`INSERT INTO owned_currency_policies
    (currency_code, unit_code, policy_version, valuation_mode, valuation_currency_code,
     conversion_numerator, conversion_denominator, effective_from, effective_to, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    "gold_dust", "mg", "v1", "FIXED_RATE", "TOSS_POINT", 1, 100, 0, null, 0,
  );
  db.query(`INSERT INTO owned_currency_policies
    (currency_code, unit_code, policy_version, valuation_mode, valuation_currency_code,
     conversion_numerator, conversion_denominator, effective_from, effective_to, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    "gold_dust", "mg", "v2", "MARKET_SNAPSHOT", "KRW", null, null, 6000, null, 6000,
  );
  const indexes = db.query("PRAGMA index_list('owned_currency_events')").all().map(row => row.name);
  assert.ok(indexes.includes("idx_owned_currency_events_time"));

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

  add(["gold-exchange-krw", X01, "gold_dust", "mg", "EXCHANGE", -5, "promotion", "p-2", "event:gold-exchange-krw", "v1", null, "exchange-2", 100, "KRW", 4500, 4500, "{}"]);
  add(["gold-policy-window", X01, "gold_dust", "mg", "ADJUSTMENT", 1, "operator", "window-1", "event:gold-policy-window", "v2", null, null, null, null, 5500, 5500, "{}"]);
  const policy = db.query(withTestWindow(queries.policy_breakdown, 1000, 7000)).all();
  const valuedGoldPolicyRows = policy
    .filter(row => row.currency_code === "gold_dust" && row.policy_version === "v1" && row.valuation_currency_code)
    .map(row => ({ valuation_currency_code: row.valuation_currency_code, exchanged_quantity: row.exchanged_quantity, recorded_valuation_amount: row.recorded_valuation_amount }))
    .sort((left, right) => left.valuation_currency_code.localeCompare(right.valuation_currency_code));
  assert.deepEqual(valuedGoldPolicyRows, [
    { valuation_currency_code: "KRW", exchanged_quantity: 5, recorded_valuation_amount: 100 },
    { valuation_currency_code: "TOSS_POINT", exchanged_quantity: 10, recorded_valuation_amount: 50 },
  ]);
  assert.equal(policy.find(row => row.currency_code === "gold_dust" && row.policy_version === "v2").issued_quantity, 0);
  const policyWindowMismatches = db.query(withTestWindow(queries.policy_window_check, 1000, 7000)).all();
  assert.deepEqual(policyWindowMismatches, [{
    currency_code: "gold_bar",
    unit_code: "mg",
    policy_version: "v1",
    effective_from: null,
    effective_to: null,
    policy_present: 0,
    event_count: 1,
  }, {
    currency_code: "gold_dust",
    unit_code: "mg",
    policy_version: "v2",
    effective_from: 6000,
    effective_to: null,
    policy_present: 1,
    event_count: 1,
  }, {
    currency_code: "stars",
    unit_code: "count",
    policy_version: "v1",
    effective_from: null,
    effective_to: null,
    policy_present: 0,
    event_count: 1,
  }]);

  assert.deepEqual(
    db.query(withTestWindow(queries.missing_market_valuation_check, 1000, 7000)).all(),
    [],
  );
  assert.deepEqual(
    db.query(withTestAsOf(queries.orphaned_conversion_group_check, 7000)).all(),
    [],
  );
  assert.deepEqual(db.query(queries.duplicate_source_check).all(), []);
  add(["duplicate-direction-1", X01, "gold_dust", "mg", "CONVERT_OUT", -2, "refine", "r-duplicate", "event:duplicate-direction-1", "v1", "conversion-duplicate", null, null, null, 6400, 6400, "{}"]);
  add(["duplicate-direction-2", X01, "gold_dust", "mg", "CONVERT_OUT", -1, "refine", "r-duplicate", "event:duplicate-direction-2", "v1", "conversion-duplicate", null, null, null, 6401, 6401, "{}"]);
  assert.deepEqual(db.query(withTestAsOf(queries.orphaned_conversion_group_check, 7000)).all(), [{
    conversion_group_id: "conversion-duplicate",
    event_count: 2,
    convert_in_count: 0,
    convert_out_count: 2,
  }]);
  let duplicates = db.query(queries.duplicate_source_check).all();
  assert.equal(duplicates.length, 1);
  assert.deepEqual(duplicates.find(row => row.source_id === "r-duplicate"), {
    source_type: "refine",
    source_id: "r-duplicate",
    event_count: 2,
  });
  add(["duplicate-conversion", X01, "gold_dust", "mg", "CONVERT_OUT", -1, "refine", "r-1", "event:duplicate-conversion", "v1", "conversion-1", null, null, null, 6400, 6400, "{}"]);
  assert.deepEqual(db.query(withTestAsOf(queries.orphaned_conversion_group_check, 7000)).all(), [
    {
      conversion_group_id: "conversion-1",
      event_count: 3,
      convert_in_count: 1,
      convert_out_count: 2,
    },
    {
      conversion_group_id: "conversion-duplicate",
      event_count: 2,
      convert_in_count: 0,
      convert_out_count: 2,
    },
  ]);
  duplicates = db.query(queries.duplicate_source_check).all();
  assert.equal(duplicates.length, 2);
  assert.deepEqual(duplicates.find(row => row.source_id === "r-1"), {
    source_type: "refine",
    source_id: "r-1",
    event_count: 3,
  });
  add(["duplicate-source", X01, "gold_dust", "mg", "ADJUSTMENT", 1, "operator", "a-1", "event:duplicate-source", "v2", null, null, null, null, 6500, 6500, "{}"]);
  duplicates = db.query(queries.duplicate_source_check).all();
  assert.equal(duplicates.length, 3);
  assert.deepEqual(duplicates.find(row => row.source_id === "a-1"), {
    source_type: "operator",
    source_id: "a-1",
    event_count: 2,
  });
  assert.throws(() => add(["duplicate-idempotency", X01, "stars", "count", "ISSUE", 1, "vote", "v-2", "event:star-issue", "v1", null, null, null, null, 7000, 7000, "{}"]));
  for (const conversionGroupId of [" ", " conversion-1", "\tconversion-1", "\nconversion-1", "conversion-1\r"]) {
    assert.throws(
      () => add(["invalid-conversion-id", X01, "gold_dust", "mg", "CONVERT_OUT", -1, "refine", "r-invalid", "event:invalid-conversion-id", "v1", conversionGroupId, null, null, null, 7100, 7100, "{}"]),
      /CHECK constraint failed/,
    );
  }
  for (const exchangeId of [" ", " exchange-1", "\texchange-1", "\nexchange-1", "exchange-1\r"]) {
    assert.throws(
      () => add(["invalid-exchange-id", X01, "gold_dust", "mg", "EXCHANGE", -1, "promotion", "p-invalid", "event:invalid-exchange-id", "v1", null, exchangeId, 1, "TOSS_POINT", 7100, 7100, "{}"]),
      /CHECK constraint failed/,
    );
  }
  for (const [index, sourceId] of ["source-1\t", "\nsource-2", "source-3\r"].entries()) {
    assert.throws(
      () => add([`invalid-source-id-${index}`, X01, "gold_dust", "mg", "ADJUSTMENT", 1, "operator", sourceId, `event:invalid-source-id-${index}`, "v1", null, null, null, null, 7200, 7200, "{}"]),
      /CHECK constraint failed/,
    );
  }
  for (const [index, idempotencyKey] of ["event:invalid-idempotency-1\t", "\nevent:invalid-idempotency-2"].entries()) {
    assert.throws(
      () => add([`invalid-idempotency-${index}`, X01, "gold_dust", "mg", "ADJUSTMENT", 1, "operator", `source-idempotency-${index}`, idempotencyKey, "v1", null, null, null, null, 7200, 7200, "{}"]),
      /CHECK constraint failed/,
    );
  }

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
