// Consumer-owned private views describe the original sources, never the mirror itself.
// Run against the same immutable SQLite snapshot used for the monthly report.
export function reconcileOwnedCurrency({ db, periodStart = 0, periodEnd = Number.MAX_SAFE_INTEGER, approvalRevision } = {}) {
  if (!Number.isSafeInteger(periodStart) || !Number.isSafeInteger(periodEnd) || periodStart < 0 || periodEnd <= periodStart) throw new Error('INVALID_RECONCILIATION_PERIOD');
  return db.transaction(() => {
    const count = (sql, ...params) => {
      const n = db.query(sql).get(...params).n;
      if (!Number.isSafeInteger(n) || n < 0) throw new Error('UNSAFE_RECONCILIATION_COUNT');
      return n;
    };
    const checks = {
      duplicateExpectedKeys: count('SELECT COUNT(*) n FROM (SELECT idempotency_key FROM owned_currency_expected_events GROUP BY idempotency_key HAVING COUNT(*)>1)'),
      missingEvents: count('SELECT COUNT(*) n FROM owned_currency_expected_events s LEFT JOIN owned_currency_events e USING(idempotency_key) WHERE e.id IS NULL'),
      mismatchedEvents: count(`SELECT COUNT(*) n FROM owned_currency_expected_events s JOIN owned_currency_events e USING(idempotency_key)
        WHERE e.user_id IS NOT s.user_id OR e.currency_code IS NOT s.currency_code OR e.unit_code IS NOT s.unit_code
        OR e.event_type IS NOT s.event_type OR e.quantity IS NOT s.quantity OR e.policy_version IS NOT s.policy_version
        OR e.source_type IS NOT s.source_type OR e.source_id IS NOT s.source_id
        OR e.valuation_amount IS NOT s.valuation_amount OR e.valuation_currency_code IS NOT s.valuation_currency_code
        OR e.exchange_id IS NOT s.exchange_id OR e.occurred_at IS NOT s.occurred_at`),
      unexpectedEvents: count('SELECT COUNT(*) n FROM owned_currency_events e LEFT JOIN owned_currency_expected_events s USING(idempotency_key) WHERE s.idempotency_key IS NULL'),
      balanceMismatches: count(`WITH a AS (SELECT user_id,currency_code,unit_code,SUM(quantity) quantity FROM owned_currency_events WHERE user_id IS NOT NULL GROUP BY user_id,currency_code,unit_code),
        b AS (SELECT user_id,currency_code,unit_code,SUM(quantity) quantity FROM owned_currency_expected_balances GROUP BY user_id,currency_code,unit_code),
        keys AS (SELECT user_id,currency_code,unit_code FROM a UNION SELECT user_id,currency_code,unit_code FROM b)
        SELECT COUNT(*) n FROM keys k LEFT JOIN a USING(user_id,currency_code,unit_code) LEFT JOIN b USING(user_id,currency_code,unit_code)
        WHERE COALESCE(a.quantity,0)<>COALESCE(b.quantity,0)`),
      unresolvedOperations: count('SELECT COUNT(*) n FROM owned_currency_reporting_issues WHERE occurred_at IS NULL OR (occurred_at >= ? AND occurred_at < ?)', periodStart, periodEnd),
    };
    if (approvalRevision !== undefined) {
      // A claimed revision must identify the evidence actually present in this snapshot.
      checks.approvalRevisionMismatch = !Number.isSafeInteger(approvalRevision) || approvalRevision < 1
        ? 1
        : count('SELECT CASE WHEN COUNT(*)=0 OR SUM(CASE WHEN revision <> ? THEN 1 ELSE 0 END)>0 THEN 1 ELSE 0 END n FROM owned_currency_close_approvals', approvalRevision);
    }
    return { scope: 'entire-snapshot', ok: Object.values(checks).every(n => n === 0), checks };
  })();
}
