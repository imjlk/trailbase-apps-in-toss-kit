---
cargo/trailbase-guest-common: minor
cargo/trailbase-toss-identity: minor
npm/@trailbase-apps-in-toss-kit/toss-mtls-client-proxy: minor
---

Verify Apps in Toss anonymous keys through the private proxy before bootstrap,
retaining the existing HMAC of ait:<hash> and canonical TrailBase user flow.
Add verified-key sealing, private identity storage, explicit message recipients,
and anonymous promotion grants/status lookup with request-local header adaptation.

Apply anonymous_identities.sql, the one-time message_outbox_recipients migration,
and optional promotion_reward_recipients.sql as new consumer migrations. Stop
legacy dispatch workers before enabling anonymous rows, preserve notification
agreement checks for both recipient types, and deploy the next proxy image before
using verification or anonymous promotion. Existing login rows remain unchanged.
Consumer real-app/sandbox validation is still required before production rollout.

Normalize anonymous enqueue identifiers before persistence so whitespace cannot
bypass idempotency or break exact notification-template agreement lookup.
