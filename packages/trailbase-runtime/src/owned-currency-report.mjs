const EVENT_TYPES = Object.freeze([
  "ISSUE",
  "SPEND",
  "CONVERT_IN",
  "CONVERT_OUT",
  "EXCHANGE",
  "EXPIRE",
  "ADJUSTMENT",
]);
export const OWNED_CURRENCY_TIMESTAMP_UNITS = Object.freeze([
  "seconds",
  "milliseconds",
]);
const TIMESTAMP_UNITS = new Set(OWNED_CURRENCY_TIMESTAMP_UNITS);
export class OwnedCurrencyReportError extends Error {
  constructor(code) {
    super(code);
    this.name = "OwnedCurrencyReportError";
    this.code = code;
  }
}

export function buildOwnedCurrencyReport({ db, periodStart, periodEnd, timestampUnit, now } = {}) {
  const generatedAt = now === undefined ? currentTimestamp(timestampUnit) : now;
  validateReportInput({ db, periodStart, periodEnd, timestampUnit, now: generatedAt });
  return db.transaction(() => {
    requireTableColumns(db, "owned_currency_events", [
      "currency_code", "unit_code", "event_type", "quantity", "source_type",
      "source_id", "policy_version", "valuation_amount", "valuation_currency_code",
      "occurred_at", "conversion_group_id",
    ]);
    requireTableColumns(db, "owned_currency_policies", [
      "currency_code", "unit_code", "policy_version", "valuation_mode",
      "valuation_currency_code", "conversion_numerator", "conversion_denominator",
      "effective_from", "effective_to",
    ]);

    const lines = db.query(`
      SELECT
        e.currency_code,
        e.unit_code,
        e.policy_version,
        e.valuation_currency_code,
        SUM(CASE WHEN e.event_type = 'ISSUE' THEN e.quantity ELSE 0 END) AS issued_quantity,
        SUM(CASE WHEN e.event_type = 'SPEND' THEN -e.quantity ELSE 0 END) AS spent_quantity,
        SUM(CASE WHEN e.event_type = 'CONVERT_OUT' THEN -e.quantity ELSE 0 END) AS converted_out_quantity,
        SUM(CASE WHEN e.event_type = 'CONVERT_IN' THEN e.quantity ELSE 0 END) AS converted_in_quantity,
        SUM(CASE WHEN e.event_type = 'EXCHANGE' THEN -e.quantity ELSE 0 END) AS exchanged_quantity,
        SUM(CASE WHEN e.event_type = 'EXPIRE' THEN -e.quantity ELSE 0 END) AS expired_quantity,
        SUM(CASE WHEN e.event_type = 'ADJUSTMENT' AND e.quantity > 0 THEN e.quantity ELSE 0 END) AS adjustment_credit_quantity,
        SUM(CASE WHEN e.event_type = 'ADJUSTMENT' AND e.quantity < 0 THEN -e.quantity ELSE 0 END) AS adjustment_debit_quantity,
        SUM(CASE WHEN e.event_type = 'EXCHANGE' THEN COALESCE(e.valuation_amount, 0) ELSE 0 END) AS recorded_valuation_amount,
        SUM(CASE WHEN e.event_type = 'EXCHANGE'
                  AND p.valuation_mode = 'MARKET_SNAPSHOT'
                  AND e.valuation_amount IS NULL
                 THEN 1 ELSE 0 END) AS missing_valuation_event_count,
        COUNT(*) AS event_count,
        p.valuation_mode,
        p.valuation_currency_code AS policy_valuation_currency_code,
        p.effective_from,
        p.effective_to,
        p.conversion_numerator,
        p.conversion_denominator,
        CASE WHEN p.policy_version IS NULL THEN 0 ELSE 1 END AS policy_present
      FROM owned_currency_events e
      LEFT JOIN owned_currency_policies p
        ON p.currency_code = e.currency_code
       AND p.unit_code = e.unit_code
       AND p.policy_version = e.policy_version
      WHERE e.occurred_at >= ?
        AND e.occurred_at < ?
      GROUP BY
        e.currency_code,
        e.unit_code,
        e.policy_version,
        e.valuation_currency_code,
        p.valuation_mode,
        p.valuation_currency_code,
        p.effective_from,
        p.effective_to,
        p.conversion_numerator,
        p.conversion_denominator,
        p.policy_version
      ORDER BY e.currency_code, e.unit_code, e.policy_version, e.valuation_currency_code
    `).all(periodStart, periodEnd).map(normalizeLine);

    const balances = db.query(`
      SELECT currency_code, unit_code, SUM(quantity) AS balance_quantity, COUNT(*) AS event_count
      FROM owned_currency_events
      WHERE occurred_at < ?
      GROUP BY currency_code, unit_code
      ORDER BY currency_code, unit_code
    `).all(periodEnd).map(row => ({
      currencyCode: text(row.currency_code),
      unitCode: text(row.unit_code),
      balanceQuantity: integer(row.balance_quantity),
      eventCount: integer(row.event_count),
    }));

    const duplicateSourceCount = integer(db.query(`
      SELECT COUNT(*) AS count FROM (
        SELECT source_type, source_id
        FROM owned_currency_events
        WHERE occurred_at < ?
        GROUP BY source_type, source_id
        HAVING COUNT(*) > 1
           AND (
             COUNT(DISTINCT COALESCE(conversion_group_id, '__no_conversion__')) > 1
             OR MAX(conversion_group_id) IS NULL
             OR COUNT(*) <> 2
             OR SUM(CASE WHEN event_type = 'CONVERT_IN' THEN 1 ELSE 0 END) <> 1
             OR SUM(CASE WHEN event_type = 'CONVERT_OUT' THEN 1 ELSE 0 END) <> 1
           )
      )
    `).get(periodEnd).count);

    const missingPolicyEventCount = integer(db.query(`
      SELECT COUNT(*) AS count
      FROM owned_currency_events e
      LEFT JOIN owned_currency_policies p
        ON p.currency_code = e.currency_code
       AND p.unit_code = e.unit_code
       AND p.policy_version = e.policy_version
      WHERE e.occurred_at >= ?
        AND e.occurred_at < ?
        AND p.policy_version IS NULL
    `).get(periodStart, periodEnd).count);

    const policyWindowMismatchEventCount = integer(db.query(`
      SELECT COUNT(*) AS count
      FROM owned_currency_events e
      JOIN owned_currency_policies p
        ON p.currency_code = e.currency_code
       AND p.unit_code = e.unit_code
       AND p.policy_version = e.policy_version
      WHERE e.occurred_at >= ?
        AND e.occurred_at < ?
        AND (
          e.occurred_at < p.effective_from
          OR (p.effective_to IS NOT NULL AND e.occurred_at >= p.effective_to)
        )
    `).get(periodStart, periodEnd).count);

    const missingValuationEventCount = integer(db.query(`
      SELECT COUNT(*) AS count
      FROM owned_currency_events e
      JOIN owned_currency_policies p
        ON p.currency_code = e.currency_code
       AND p.unit_code = e.unit_code
       AND p.policy_version = e.policy_version
      WHERE e.occurred_at >= ?
        AND e.occurred_at < ?
        AND e.event_type = 'EXCHANGE'
        AND p.valuation_mode = 'MARKET_SNAPSHOT'
        AND e.valuation_amount IS NULL
    `).get(periodStart, periodEnd).count);

    const orphanedConversionGroupCount = integer(db.query(`
      SELECT COUNT(*) AS count
      FROM (
        SELECT conversion_group_id
        FROM owned_currency_events
        WHERE occurred_at < ?
          AND conversion_group_id IS NOT NULL
        GROUP BY conversion_group_id
        HAVING COUNT(*) <> 2
           OR SUM(CASE WHEN event_type = 'CONVERT_IN' THEN 1 ELSE 0 END) <> 1
           OR SUM(CASE WHEN event_type = 'CONVERT_OUT' THEN 1 ELSE 0 END) <> 1
      )
    `).get(periodEnd).count);

    const unknownEventCount = integer(db.query(`
      SELECT COUNT(*) AS count
      FROM owned_currency_events
      WHERE occurred_at >= ?
        AND occurred_at < ?
        AND event_type NOT IN (${EVENT_TYPES.map(() => "?").join(", ")})
    `).get(periodStart, periodEnd, ...EVENT_TYPES).count);

    return {
      schemaVersion: 1,
      timestampUnit,
      period: { start: periodStart, end: periodEnd },
      generatedAt,
      lines,
      balances,
      quality: {
        duplicateSourceCount,
        orphanedConversionGroupCount,
        missingPolicyEventCount,
        missingValuationEventCount,
        policyWindowMismatchEventCount,
        unknownEventCount,
      },
    };
  })();
}

export function formatOwnedCurrencyCsv(report) {
  const header = [
    "rowType", "currencyCode", "unitCode", "policyVersion", "valuationCurrencyCode",
    "policyValuationCurrencyCode", "policyValuationMode", "policyConversionNumerator",
    "policyConversionDenominator", "policyEffectiveFrom", "policyEffectiveTo",
    "issuedQuantity", "spentQuantity", "convertedOutQuantity", "convertedInQuantity",
    "exchangedQuantity", "expiredQuantity", "adjustmentCreditQuantity", "adjustmentDebitQuantity",
    "recordedValuationAmount", "missingValuationEventCount", "eventCount", "balanceQuantity",
    "policyPresent",
    "duplicateSourceCount", "orphanedConversionGroupCount", "missingPolicyEventCount",
    "policyWindowMismatchEventCount", "unknownEventCount",
    "periodStart", "periodEnd", "timestampUnit", "generatedAt",
    "toolName", "toolVersion", "sourceCommit", "reportedServerVersion",
  ];
  const columns = new Map(header.map((name, index) => [name, index]));
  const rows = [header];
  const rowFor = values => {
    const row = Array(header.length).fill("");
    for (const [name, value] of Object.entries(values)) {
      const index = columns.get(name);
      if (index !== undefined) row[index] = value;
    }
    return row;
  };
  for (const line of report.lines) {
    rows.push(rowFor({
      rowType: "period",
      currencyCode: line.currencyCode,
      unitCode: line.unitCode,
      policyVersion: line.policyVersion,
      valuationCurrencyCode: line.valuationCurrencyCode,
      policyValuationCurrencyCode: line.policy.valuationCurrencyCode,
      policyValuationMode: line.policy.valuationMode,
      policyConversionNumerator: line.policy.conversionNumerator,
      policyConversionDenominator: line.policy.conversionDenominator,
      policyEffectiveFrom: line.policy.effectiveFrom,
      policyEffectiveTo: line.policy.effectiveTo,
      issuedQuantity: line.issuedQuantity,
      spentQuantity: line.spentQuantity,
      convertedOutQuantity: line.convertedOutQuantity,
      convertedInQuantity: line.convertedInQuantity,
      exchangedQuantity: line.exchangedQuantity,
      expiredQuantity: line.expiredQuantity,
      adjustmentCreditQuantity: line.adjustmentCreditQuantity,
      adjustmentDebitQuantity: line.adjustmentDebitQuantity,
      recordedValuationAmount: line.recordedValuationAmount,
      missingValuationEventCount: line.missingValuationEventCount,
      eventCount: line.eventCount,
      policyPresent: line.policy.present,
    }));
  }
  for (const balance of report.balances) {
    rows.push(rowFor({
      rowType: "balance",
      currencyCode: balance.currencyCode,
      unitCode: balance.unitCode,
      eventCount: balance.eventCount,
      balanceQuantity: balance.balanceQuantity,
    }));
  }
  rows.push(rowFor({
    rowType: "quality",
    missingValuationEventCount: report.quality.missingValuationEventCount,
    duplicateSourceCount: report.quality.duplicateSourceCount,
    orphanedConversionGroupCount: report.quality.orphanedConversionGroupCount,
    missingPolicyEventCount: report.quality.missingPolicyEventCount,
    policyWindowMismatchEventCount: report.quality.policyWindowMismatchEventCount,
    unknownEventCount: report.quality.unknownEventCount,
  }));
  rows.push(rowFor({
    rowType: "metadata",
    periodStart: report.period.start,
    periodEnd: report.period.end,
    timestampUnit: report.timestampUnit,
    generatedAt: report.generatedAt,
    toolName: report.tool?.name,
    toolVersion: report.tool?.version,
    sourceCommit: report.tool?.sourceCommit,
    reportedServerVersion: report.tool?.reportedServerVersion,
  }));
  return `${rows.map(row => row.map(csvCell).join(",")).join("\n")}\n`;
}

function validateReportInput({ db, periodStart, periodEnd, timestampUnit, now }) {
  if (!db || typeof db.query !== "function" || typeof db.transaction !== "function") fail("INVALID_DATABASE");
  if (!TIMESTAMP_UNITS.has(timestampUnit)) fail("EXPLICIT_TIMESTAMP_UNIT_REQUIRED");
  if (!safeNonNegativeInteger(periodStart) || !safeNonNegativeInteger(periodEnd) || periodStart >= periodEnd) {
    fail("INVALID_REPORT_PERIOD");
  }
  if (!safeNonNegativeInteger(now)) fail("INVALID_REPORT_TIME");
}

function requireTableColumns(db, table, required) {
  const present = db.query("SELECT name FROM sqlite_schema WHERE type = 'table' AND name = ?").get(table);
  if (!present) fail("REPORT_SCHEMA_UNAVAILABLE");
  const columns = new Set(db.query(`PRAGMA table_info("${table}")`).all().map(row => row.name));
  if (required.some(column => !columns.has(column))) fail("REPORT_SCHEMA_UNAVAILABLE");
}

function currentTimestamp(timestampUnit) {
  const milliseconds = Date.now();
  return timestampUnit === "seconds" ? Math.floor(milliseconds / 1000) : milliseconds;
}

function normalizeLine(row) {
  return {
    currencyCode: text(row.currency_code),
    unitCode: text(row.unit_code),
    policyVersion: text(row.policy_version),
    valuationCurrencyCode: nullableText(row.valuation_currency_code),
    issuedQuantity: integer(row.issued_quantity),
    spentQuantity: integer(row.spent_quantity),
    convertedOutQuantity: integer(row.converted_out_quantity),
    convertedInQuantity: integer(row.converted_in_quantity),
    exchangedQuantity: integer(row.exchanged_quantity),
    expiredQuantity: integer(row.expired_quantity),
    adjustmentCreditQuantity: integer(row.adjustment_credit_quantity),
    adjustmentDebitQuantity: integer(row.adjustment_debit_quantity),
    recordedValuationAmount: integer(row.recorded_valuation_amount),
    missingValuationEventCount: integer(row.missing_valuation_event_count),
    eventCount: integer(row.event_count),
    policy: {
      present: row.policy_present === 1,
      valuationMode: nullableText(row.valuation_mode),
      valuationCurrencyCode: nullableText(row.policy_valuation_currency_code),
      effectiveFrom: nullableInteger(row.effective_from),
      effectiveTo: nullableInteger(row.effective_to),
      conversionNumerator: nullableInteger(row.conversion_numerator),
      conversionDenominator: nullableInteger(row.conversion_denominator),
    },
  };
}

function csvCell(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  const string = String(value);
  const safe = /^[=+\-@]/.test(string) ? `'${string}` : string;
  return /[",\n\r]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

export function isOwnedCurrencySafeNonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function safeNonNegativeInteger(value) {
  return isOwnedCurrencySafeNonNegativeInteger(value);
}

function integer(value) {
  if (!Number.isSafeInteger(value)) fail("REPORT_NUMERIC_OVERFLOW");
  return value;
}

function nullableInteger(value) {
  return value === null || value === undefined ? null : integer(value);
}

function text(value) {
  if (typeof value !== "string" || value.length === 0) fail("REPORT_INVALID_TEXT");
  return value;
}

function nullableText(value) {
  return value === null || value === undefined ? null : text(value);
}

function fail(code) {
  throw new OwnedCurrencyReportError(code);
}
