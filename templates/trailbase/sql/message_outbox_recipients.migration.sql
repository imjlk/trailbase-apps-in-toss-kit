-- Apply ONCE as a new consumer migration after anonymous_identities.sql.
-- Do not rewrite the existing message_outbox baseline. Existing login rows keep
-- their HMAC/sealed values. Anonymous rows use an empty compatibility placeholder
-- in the legacy NOT NULL toss_user_key_hmac column; their identity is separate.
ALTER TABLE message_outbox ADD COLUMN recipient_kind TEXT NOT NULL DEFAULT 'TOSS_USER_KEY'
  CHECK (recipient_kind IN ('TOSS_USER_KEY', 'ANONYMOUS_KEY'));
ALTER TABLE message_outbox ADD COLUMN anonymous_hash_hmac TEXT REFERENCES anonymous_identities(anonymous_hash_hmac);

CREATE TRIGGER message_outbox_recipient_insert BEFORE INSERT ON message_outbox
WHEN (NEW.recipient_kind = 'TOSS_USER_KEY' AND NEW.anonymous_hash_hmac IS NOT NULL)
  OR (NEW.recipient_kind = 'ANONYMOUS_KEY' AND (
    NEW.toss_user_key_hmac <> '' OR NEW.toss_user_key_sealed IS NOT NULL
    OR NEW.anonymous_hash_hmac IS NULL
    OR NOT EXISTS (SELECT 1 FROM anonymous_identities a WHERE a.anonymous_hash_hmac = NEW.anonymous_hash_hmac
      AND a.user_id = NEW.user_id AND a.revoked_at IS NULL)))
BEGIN SELECT RAISE(ABORT, 'Invalid message recipient'); END;

CREATE TRIGGER message_outbox_recipient_update BEFORE UPDATE OF recipient_kind, anonymous_hash_hmac, user_id, toss_user_key_hmac, toss_user_key_sealed ON message_outbox
WHEN (NEW.recipient_kind = 'TOSS_USER_KEY' AND NEW.anonymous_hash_hmac IS NOT NULL)
  OR (NEW.recipient_kind = 'ANONYMOUS_KEY' AND (
    NEW.toss_user_key_hmac <> '' OR NEW.toss_user_key_sealed IS NOT NULL
    OR NEW.anonymous_hash_hmac IS NULL
    OR NOT EXISTS (SELECT 1 FROM anonymous_identities a WHERE a.anonymous_hash_hmac = NEW.anonymous_hash_hmac
      AND a.user_id = NEW.user_id AND a.revoked_at IS NULL)))
BEGIN SELECT RAISE(ABORT, 'Invalid message recipient'); END;
