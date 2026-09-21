-- Private policy history for owned_currency_events. Do not expose this table
-- through the Record API. Copy it into the same consumer database as the
-- owned-currency journal and keep migrations forward-only.
--
-- conversion_numerator/denominator describe a fixed rational rate when the
-- policy uses FIXED_RATE. MARKET_SNAPSHOT policies keep the rate NULL because
-- each event stores the valuation captured at the time of the exchange.
CREATE TABLE IF NOT EXISTS owned_currency_policies (
  currency_code TEXT NOT NULL CHECK (
    length(trim(currency_code, ' ' || char(9) || char(10) || char(13))) BETWEEN 1 AND 64
    AND currency_code = trim(currency_code, ' ' || char(9) || char(10) || char(13))
    AND currency_code NOT GLOB '*[^A-Za-z0-9._-]*'
  ),
  unit_code TEXT NOT NULL CHECK (
    length(trim(unit_code, ' ' || char(9) || char(10) || char(13))) BETWEEN 1 AND 64
    AND unit_code = trim(unit_code, ' ' || char(9) || char(10) || char(13))
    AND unit_code NOT GLOB '*[^A-Za-z0-9._-]*'
  ),
  policy_version TEXT NOT NULL CHECK (
    length(trim(policy_version, ' ' || char(9) || char(10) || char(13))) BETWEEN 1 AND 64
    AND policy_version = trim(policy_version, ' ' || char(9) || char(10) || char(13))
  ),
  valuation_mode TEXT NOT NULL CHECK (
    valuation_mode IN ('FIXED_RATE', 'MARKET_SNAPSHOT', 'NONE')
  ),
  valuation_currency_code TEXT CHECK (
    valuation_currency_code IS NULL
    OR (
      length(trim(valuation_currency_code, ' ' || char(9) || char(10) || char(13))) BETWEEN 1 AND 64
      AND valuation_currency_code = trim(valuation_currency_code, ' ' || char(9) || char(10) || char(13))
      AND valuation_currency_code NOT GLOB '*[^A-Za-z0-9._-]*'
    )
  ),
  conversion_numerator INTEGER CHECK (
    conversion_numerator IS NULL OR conversion_numerator > 0
  ),
  conversion_denominator INTEGER CHECK (
    conversion_denominator IS NULL OR conversion_denominator > 0
  ),
  effective_from INTEGER NOT NULL CHECK (effective_from >= 0),
  effective_to INTEGER CHECK (effective_to IS NULL OR effective_to > effective_from),
  notes TEXT,
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  PRIMARY KEY (currency_code, unit_code, policy_version),
  CHECK ((conversion_numerator IS NULL) = (conversion_denominator IS NULL)),
  CHECK (
    (valuation_mode = 'FIXED_RATE'
      AND valuation_currency_code IS NOT NULL
      AND conversion_numerator IS NOT NULL
      AND conversion_denominator IS NOT NULL)
    OR (valuation_mode = 'MARKET_SNAPSHOT'
      AND valuation_currency_code IS NOT NULL
      AND conversion_numerator IS NULL
      AND conversion_denominator IS NULL)
    OR (valuation_mode = 'NONE'
      AND valuation_currency_code IS NULL
      AND conversion_numerator IS NULL
      AND conversion_denominator IS NULL)
  )
) STRICT;

CREATE INDEX IF NOT EXISTS idx_owned_currency_policies_effective
  ON owned_currency_policies(currency_code, unit_code, effective_from DESC);

CREATE INDEX IF NOT EXISTS idx_owned_currency_policies_valuation
  ON owned_currency_policies(valuation_currency_code, effective_from DESC)
  WHERE valuation_currency_code IS NOT NULL;
