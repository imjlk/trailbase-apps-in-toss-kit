#!/usr/bin/env bun
// Synthetic in-memory fixture measurements, never production throughput claims.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Database } from "bun:sqlite";
import { inspectLedger } from "../../packages/trailbase-runtime/src/ledger-doctor.mjs";
import { createSseParser } from "../../packages/trailbase-client/src/index.ts";

const db = new Database(":memory:");
function percentiles(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const at = p => Number(sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)].toFixed(4));
  return { samples: sorted.length, p50Milliseconds: at(0.5), p95Milliseconds: at(0.95) };
}
function measure(work, samples) {
  for (let i = 0; i < 5; i++) work();
  return percentiles(Array.from({ length: samples }, () => {
    const started = performance.now(); work(); return performance.now() - started;
  }));
}
try {
  db.exec("PRAGMA foreign_keys=ON; CREATE TABLE _user(id BLOB PRIMARY KEY) STRICT; INSERT INTO _user VALUES (X'01');");
  db.exec(readFileSync(new URL("../../templates/trailbase/sql/iap_orders.sql", import.meta.url), "utf8"));
  const insert = db.query("INSERT INTO iap_orders (order_id,user_id,toss_user_key_hmac,product_id,status,provider_status,created_at,updated_at) VALUES (?1,X'01','synthetic','sku','PENDING','IN_PROGRESS',100,100)");
  db.transaction(() => { for (let i = 0; i < 5000; i++) insert.run(`fixture-${i}`); })();
  const diagnostic = measure(() => {
    const result = inspectLedger({ db, kind: "iap", recordId: "fixture-4999", timestampUnit: "milliseconds", now: 1000 });
    assert.equal(result.ok, true); assert.equal(result.recoveryPlan.allowsAutomaticRetry, false);
  }, 200);
  const events = 2000; const payload = 'data: {"Update":{"value":1}}\n\n'.repeat(events);
  const sse = measure(() => {
    let count = 0; const parser = createSseParser(() => { count++; });
    for (let i = 0; i < payload.length; i += 127) parser.push(payload.slice(i, i + 127));
    assert.equal(count, events);
  }, 40);
  console.log(JSON.stringify({ schemaVersion: 1, ok: true, scope: "synthetic in-memory fixture; no network or device workload",
    ledger: { rows: 5000, operation: "private IAP diagnostic lookup", ...diagnostic },
    sse: { eventsPerSample: events, bytesPerSample: Buffer.byteLength(payload), ...sse } }, null, 2));
} finally { db.close(); }
