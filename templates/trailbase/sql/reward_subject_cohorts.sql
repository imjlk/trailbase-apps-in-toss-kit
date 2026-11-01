-- Private point-reward cohort registry. Do not expose it through Record API.
-- subject_hash is a domain-separated SHA-256 of a stable app-scoped identity (for
-- example a scoped identity HMAC), never a raw Toss key, HMAC or sealed value.
-- There is deliberately no _user reference: deleting and re-joining an account must
-- not restart a welcome window. Apply the app's retention policy explicitly.
CREATE TABLE IF NOT EXISTS reward_subject_cohorts (
  subject_hash TEXT PRIMARY KEY CHECK (length(subject_hash) = 64),
  cohort TEXT NOT NULL CHECK (cohort IN ('LEGACY', 'WELCOME')),
  first_seen_at INTEGER NOT NULL CHECK (first_seen_at >= 0),
  -- Exclusive end of new welcome point eligibility. LEGACY follows the server policy.
  welcome_points_ends_at INTEGER,
  policy_version TEXT NOT NULL CHECK (length(policy_version) BETWEEN 1 AND 64),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  CHECK ((cohort = 'WELCOME') = (welcome_points_ends_at IS NOT NULL)),
  CHECK (welcome_points_ends_at IS NULL OR welcome_points_ends_at > first_seen_at)
) STRICT;
