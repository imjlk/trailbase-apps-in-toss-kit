-- TrailBase SQL Editor examples for owned_currency_events.
--
-- These are read-only examples. Replace the two timestamp literals with the
-- timestamp unit used by the consumer migration. The upper bound is
-- exclusive, so adjacent periods cannot double-count an event.
--
-- The event journal is private. Run these queries only in an authenticated
-- operator/admin SQL Editor session; never expose the raw rows through a
-- public Record API view.

-- Query: monthly_summary
WITH period AS (
  SELECT
    CAST(1788192000000 AS INTEGER) AS period_start,
    CAST(1790870400000 AS INTEGER) AS period_end
)
SELECT
  currency_code,
  unit_code,
  SUM(CASE WHEN event_type = 'ISSUE' THEN quantity ELSE 0 END) AS issued_quantity,
  SUM(CASE WHEN event_type = 'SPEND' THEN -quantity ELSE 0 END) AS spent_quantity,
  SUM(CASE WHEN event_type = 'CONVERT_OUT' THEN -quantity ELSE 0 END) AS converted_out_quantity,
  SUM(CASE WHEN event_type = 'CONVERT_IN' THEN quantity ELSE 0 END) AS converted_in_quantity,
  SUM(CASE WHEN event_type = 'EXCHANGE' THEN -quantity ELSE 0 END) AS exchanged_quantity,
  SUM(CASE WHEN event_type = 'EXPIRE' THEN -quantity ELSE 0 END) AS expired_quantity,
  SUM(CASE WHEN event_type = 'ADJUSTMENT' AND quantity > 0 THEN quantity ELSE 0 END) AS adjustment_credit_quantity,
  SUM(CASE WHEN event_type = 'ADJUSTMENT' AND quantity < 0 THEN -quantity ELSE 0 END) AS adjustment_debit_quantity,
  COUNT(*) AS event_count
FROM owned_currency_events, period
WHERE occurred_at >= period_start
  AND occurred_at < period_end
GROUP BY currency_code, unit_code
ORDER BY currency_code, unit_code;

-- Query: balance_as_of
WITH period AS (
  SELECT CAST(1790870400000 AS INTEGER) AS as_of
)
SELECT
  currency_code,
  unit_code,
  SUM(quantity) AS balance_quantity,
  COUNT(*) AS event_count
FROM owned_currency_events, period
WHERE occurred_at < as_of
GROUP BY currency_code, unit_code
ORDER BY currency_code, unit_code;

-- Query: policy_breakdown
WITH period AS (
  SELECT
    CAST(1788192000000 AS INTEGER) AS period_start,
    CAST(1790870400000 AS INTEGER) AS period_end
)
SELECT
  currency_code,
  unit_code,
  policy_version,
  valuation_currency_code,
  SUM(CASE WHEN event_type = 'ISSUE' THEN quantity ELSE 0 END) AS issued_quantity,
  SUM(CASE WHEN event_type = 'EXCHANGE' THEN -quantity ELSE 0 END) AS exchanged_quantity,
  SUM(CASE WHEN event_type = 'EXCHANGE' THEN COALESCE(valuation_amount, 0) ELSE 0 END) AS recorded_valuation_amount,
  COUNT(*) AS event_count
FROM owned_currency_events, period
WHERE occurred_at >= period_start
  AND occurred_at < period_end
GROUP BY currency_code, unit_code, policy_version, valuation_currency_code
ORDER BY currency_code, unit_code, policy_version, valuation_currency_code;

-- Query: policy_window_check
SELECT
  e.currency_code,
  e.unit_code,
  e.policy_version,
  p.effective_from,
  p.effective_to,
  COUNT(*) AS event_count
FROM owned_currency_events e
JOIN owned_currency_policies p
  ON p.currency_code = e.currency_code
 AND p.unit_code = e.unit_code
 AND p.policy_version = e.policy_version
WHERE e.occurred_at >= 1788192000000
  AND e.occurred_at < 1790870400000
  AND (
    e.occurred_at < p.effective_from
    OR (p.effective_to IS NOT NULL AND e.occurred_at >= p.effective_to)
  )
GROUP BY e.currency_code, e.unit_code, e.policy_version, p.effective_from, p.effective_to
ORDER BY e.currency_code, e.unit_code, e.policy_version;

-- Query: duplicate_source_check
SELECT
  source_type,
  source_id,
  COUNT(*) AS event_count
FROM owned_currency_events
GROUP BY source_type, source_id
-- A conversion intentionally has one input and one output row. Its shared
-- conversion_group_id makes exactly that pair safe; other repeated sources
-- need review. A third row in the same conversion group is also suspicious.
HAVING COUNT(*) > 1
   AND (
     COUNT(DISTINCT COALESCE(conversion_group_id, '__no_conversion__')) > 1
     OR MAX(conversion_group_id) IS NULL
     OR COUNT(*) <> 2
     OR SUM(CASE WHEN event_type = 'CONVERT_IN' THEN 1 ELSE 0 END) <> 1
     OR SUM(CASE WHEN event_type = 'CONVERT_OUT' THEN 1 ELSE 0 END) <> 1
   )
ORDER BY event_count DESC, source_type, source_id;
