import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import fixtures from "../../../fixtures/contracts/apps-in-toss.v1.json" with { type: "json" };
import { inspectLedger } from "../src/ledger-doctor.mjs";

test("diagnostics preserve all shared IAP states and never broaden grant verification", () => {
  const db = new Database(":memory:");
  try {
    db.exec("CREATE TABLE _user(id BLOB PRIMARY KEY); INSERT INTO _user VALUES(X'01');");
    db.exec(readFileSync(new URL("../../../templates/trailbase/sql/iap_orders.sql", import.meta.url), "utf8"));
    for (const row of fixtures.iap) {
      db.exec("DELETE FROM iap_orders");
      db.query(`INSERT INTO iap_orders(order_id,user_id,product_id,status,provider_status,created_at,updated_at)
        VALUES('fixture-order',X'01','fixture-coins',?,?,10,20)`).run(row.ledgerStatus, row.proxyResponse.providerStatus);
      const report = inspectLedger({ db, kind: "iap", recordId: "fixture-order", timestampUnit: "milliseconds", now: 100 });
      expect(report.record.providerStatus).toBe(row.diagnosticProviderStatus);
      expect(report.recoveryPlan.actions).toEqual([row.diagnosticAction]);
      expect(report.recoveryPlan.allowsAutomaticRetry).toBe(false);
      expect(report.recoveryPlan.requiresFreshRead).toBe(true);
    }
  } finally { db.close(); }
});
