-- Optional identity binding for anonymous grants and later result lookups.
CREATE TABLE IF NOT EXISTS promotion_reward_recipients (
  reward_id TEXT PRIMARY KEY REFERENCES promotion_reward_ledger(id) ON DELETE CASCADE,
  anonymous_hash_hmac TEXT NOT NULL REFERENCES anonymous_identities(anonymous_hash_hmac)
) STRICT;
