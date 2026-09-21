import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  buildOwnedCurrencyReport,
  formatOwnedCurrencyCsv,
  OwnedCurrencyReportError,
} from "../src/owned-currency-report.mjs";

const root = path.resolve(new URL("../../..", import.meta.url).pathname);
const eventSchema = readFileSync(path.join(root, "templates/trailbase/sql/owned_currency_events.sql"), "utf8");
const policySchema = readFileSync(path.join(root, "templates/trailbase/sql/owned_currency_policies.sql"), "utf8");

describe("owned currency report", () => {
  test("aggregates a half-open period, preserves valuation denominations, and reports quality facts", () => {
    const db = createDatabase();
    try {
      seedPolicy(db, "gold_dust", "mg", "v1", "FIXED_RATE", "TOSS_POINT", 1, 100, 0, null);
      seedPolicy(db, "gold_dust", "mg", "v2", "MARKET_SNAPSHOT", "KRW", null, null, 3000, null);
      seedPolicy(db, "gold_bar", "mg", "v1", "NONE", null, null, null, 0, null);
      insertEvent(db, ["issue", "gold_dust", "mg", "ISSUE", 100, "mission", "mission-1", "event:issue", "v1", null, null, null, null, 1000]);
      insertEvent(db, ["exchange-point", "gold_dust", "mg", "EXCHANGE", -10, "promotion", "exchange-1", "event:exchange-point", "v1", null, "exchange-1", 50, "TOSS_POINT", 2000]);
      insertEvent(db, ["exchange-krw", "gold_dust", "mg", "EXCHANGE", -5, "promotion", "exchange-2", "event:exchange-krw", "v1", null, "exchange-2", 100, "KRW", 2500]);
      insertEvent(db, ["convert-out", "gold_dust", "mg", "CONVERT_OUT", -20, "refine", "refine-1", "event:convert-out", "v1", "conversion-1", null, null, null, 2600]);
      insertEvent(db, ["convert-in", "gold_bar", "mg", "CONVERT_IN", 2, "refine", "refine-1", "event:convert-in", "v1", "conversion-1", null, null, null, 2600]);
      insertEvent(db, ["missing-policy", "stars", "count", "ISSUE", 4, "vote", "vote-1", "event:missing-policy", "missing", null, null, null, null, 3000]);
      insertEvent(db, ["policy-window", "gold_dust", "mg", "ADJUSTMENT", 1, "operator", "window-source", "event:policy-window", "v2", null, null, null, null, 2900]);
      insertEvent(db, ["duplicate-a", "gold_dust", "mg", "ADJUSTMENT", 1, "operator", "same-source", "event:duplicate-a", "v2", null, null, null, null, 3500]);
      insertEvent(db, ["duplicate-b", "gold_dust", "mg", "ADJUSTMENT", 1, "operator", "same-source", "event:duplicate-b", "v2", null, null, null, null, 3501]);
      insertEvent(db, ["exchange-missing-valuation", "gold_dust", "mg", "EXCHANGE", -1, "promotion", "exchange-3", "event:exchange-3", "v2", null, "exchange-3", null, null, 4000]);
      insertEvent(db, ["boundary", "gold_dust", "mg", "ISSUE", 9, "mission", "boundary", "event:boundary", "v1", null, null, null, null, 5000]);

      const report = buildOwnedCurrencyReport({
        db,
        periodStart: 1000,
        periodEnd: 5000,
        timestampUnit: "milliseconds",
        now: 5000,
      });

      expect(report.period).toEqual({ start: 1000, end: 5000 });
      expect(report.quality).toEqual({
        duplicateSourceCount: 1,
        missingPolicyEventCount: 1,
        missingValuationEventCount: 1,
        policyWindowMismatchEventCount: 1,
        unknownEventCount: 0,
      });
      expect(report.lines.find(line => line.valuationCurrencyCode === "TOSS_POINT")).toMatchObject({
        currencyCode: "gold_dust",
        exchangedQuantity: 10,
        recordedValuationAmount: 50,
        policy: {
          present: true,
          valuationMode: "FIXED_RATE",
          valuationCurrencyCode: "TOSS_POINT",
          conversionNumerator: 1,
          conversionDenominator: 100,
        },
      });
      expect(report.lines.find(line => line.valuationCurrencyCode === "KRW")).toMatchObject({
        currencyCode: "gold_dust",
        exchangedQuantity: 5,
        recordedValuationAmount: 100,
        policy: { valuationCurrencyCode: "TOSS_POINT" },
      });
      expect(report.lines.find(line => line.policyVersion === "v2")).toMatchObject({
        missingValuationEventCount: 1,
        policy: {
          valuationMode: "MARKET_SNAPSHOT",
          valuationCurrencyCode: "KRW",
          effectiveFrom: 3000,
        },
      });
      expect(report.lines.find(line => line.policyVersion === "missing")).toMatchObject({
        currencyCode: "stars",
        policy: { present: false },
      });
      expect(report.balances).toEqual([
        { currencyCode: "gold_bar", unitCode: "mg", balanceQuantity: 2, eventCount: 1 },
        { currencyCode: "gold_dust", unitCode: "mg", balanceQuantity: 67, eventCount: 8 },
        { currencyCode: "stars", unitCode: "count", balanceQuantity: 4, eventCount: 1 },
      ]);

      insertEvent(db, ["future-duplicate-a", "gold_dust", "mg", "ADJUSTMENT", 1, "operator", "future-source", "event:future-a", "v1", null, null, null, null, 6000]);
      insertEvent(db, ["future-duplicate-b", "gold_dust", "mg", "ADJUSTMENT", 1, "operator", "future-source", "event:future-b", "v1", null, null, null, null, 6001]);
      expect(buildOwnedCurrencyReport({
        db,
        periodStart: 1000,
        periodEnd: 5000,
        timestampUnit: "milliseconds",
        now: 5000,
      }).quality.duplicateSourceCount).toBe(1);

      const csv = formatOwnedCurrencyCsv(report);
      expect(csv).toContain("rowType,currencyCode,unitCode");
      expect(csv).toContain("period,gold_dust,mg");
      expect(csv).toContain("balance,gold_dust,mg");
      expect(csv).toContain("policyValuationMode,policyConversionNumerator,policyConversionDenominator,policyEffectiveFrom,policyEffectiveTo");
      expect(csv).toContain("recordedValuationAmount,missingValuationEventCount,eventCount");
      const qualityRow = csv.split("\n").find(row => row.startsWith("quality,"));
      const header = csv.split("\n")[0].split(",");
      const column = name => header.indexOf(name);
      const qualityValues = qualityRow.split(",");
      expect(qualityValues[column("duplicateSourceCount")]).toBe("1");
      expect(qualityValues[column("missingPolicyEventCount")]).toBe("1");
      expect(qualityValues[column("missingValuationEventCount")]).toBe("1");
      expect(qualityValues[column("policyWindowMismatchEventCount")]).toBe("1");
      expect(qualityValues[column("unknownEventCount")]).toBe("0");
      const metadataRow = csv.split("\n").find(row => row.startsWith("metadata,"));
      const metadataValues = metadataRow.split(",");
      expect(metadataValues[column("periodStart")]).toBe("1000");
      expect(metadataValues[column("periodEnd")]).toBe("5000");
      expect(metadataValues[column("timestampUnit")]).toBe("milliseconds");
      expect(metadataValues[column("generatedAt")]).toBe("5000");
      const balanceRow = csv.split("\n").find(row => row.startsWith("balance,gold_dust,mg"));
      const balanceValues = balanceRow.split(",");
      expect(balanceValues[column("eventCount")]).toBe("8");
      expect(balanceValues[column("balanceQuantity")]).toBe("67");
      const fixedPeriodRow = csv.split("\n").find(row => row.startsWith("period,gold_dust,mg,v1,TOSS_POINT"));
      const fixedPeriodValues = fixedPeriodRow.split(",");
      expect(fixedPeriodValues[column("policyValuationMode")]).toBe("FIXED_RATE");
      expect(fixedPeriodValues[column("policyConversionNumerator")]).toBe("1");
      expect(fixedPeriodValues[column("policyConversionDenominator")]).toBe("100");
      expect(fixedPeriodValues[column("policyEffectiveFrom")]).toBe("0");
      expect(csv).not.toContain("same-source");
    } finally {
      db.close();
    }
  });

  test("uses the selected timestamp unit for the default generation time", () => {
    const db = createDatabase();
    try {
      const before = Math.floor(Date.now() / 1000);
      const report = buildOwnedCurrencyReport({
        db,
        periodStart: 0,
        periodEnd: 1,
        timestampUnit: "seconds",
      });
      const after = Math.floor(Date.now() / 1000);
      expect(report.generatedAt).toBeGreaterThanOrEqual(before);
      expect(report.generatedAt).toBeLessThanOrEqual(after);
    } finally {
      db.close();
    }
  });

  test("fails closed for invalid periods and missing policy schema", () => {
    const db = new Database(":memory:");
    try {
      expect(() => buildOwnedCurrencyReport({ db, periodStart: 10, periodEnd: 10, timestampUnit: "milliseconds" }))
        .toThrow(new OwnedCurrencyReportError("INVALID_REPORT_PERIOD"));
      expect(() => buildOwnedCurrencyReport({ db, periodStart: 0, periodEnd: 1, timestampUnit: "milliseconds", now: null }))
        .toThrow(new OwnedCurrencyReportError("INVALID_REPORT_TIME"));
    } finally {
      db.close();
    }
  });
});

function createDatabase() {
  const db = new Database(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("CREATE TABLE _user (id BLOB PRIMARY KEY) STRICT");
  db.exec(eventSchema);
  db.exec(policySchema);
  return db;
}

function seedPolicy(db, currencyCode, unitCode, version, mode, valuationCurrencyCode, numerator, denominator, effectiveFrom, effectiveTo) {
  db.query(`INSERT INTO owned_currency_policies
    (currency_code, unit_code, policy_version, valuation_mode, valuation_currency_code,
     conversion_numerator, conversion_denominator, effective_from, effective_to, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(currencyCode, unitCode, version, mode, valuationCurrencyCode, numerator, denominator, effectiveFrom, effectiveTo, effectiveFrom);
}

function insertEvent(db, [id, currencyCode, unitCode, eventType, quantity, sourceType, sourceId,
  idempotencyKey, policyVersion, conversionGroupId, exchangeId, valuationAmount,
  valuationCurrencyCode, occurredAt]) {
  db.query(`INSERT INTO owned_currency_events
    (id, currency_code, unit_code, event_type, quantity, source_type, source_id,
     idempotency_key, policy_version, conversion_group_id, exchange_id,
     valuation_amount, valuation_currency_code, occurred_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, currencyCode, unitCode, eventType, quantity, sourceType, sourceId,
      idempotencyKey, policyVersion, conversionGroupId, exchangeId, valuationAmount,
      valuationCurrencyCode, occurredAt, occurredAt);
}
