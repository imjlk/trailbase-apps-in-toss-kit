# App-owned ad and share rewards

`trailbase_guest_common::app_rewards` provides server-issued attempts and a local
credit ledger for app-owned rewards. Copy `templates/trailbase/sql/app_reward_attempts.sql`
into a new consumer migration and rebuild the WASM guest. Keep both tables private:
no Record API collection or view should expose them. Existing migrations need no rewrite.

The attempt binds an authenticated TrailBase principal, placement, source, server
policy version, amount, unit and expiry. The server generates a random 192-bit ID.
A grant row with that unique attempt ID **is the credit**. Claim and any optional
balance projection must commit in one SQLite transaction; do not call another
payment or grant service after committing the row. Spending and projections are
consumer-owned and must not count the same grant twice.

## Trust and policy

The SDK's [rewarded ad event](https://developers-apps-in-toss.toss.im/bedrock/reference/framework/광고/IntegratedAd.html)
is a client trigger. An attempt ID, `earned`, elapsed time or client-supplied unit
amount does not prove that an ad was viewed. Issuance requires a server offer policy;
claim requires a separate server eligibility policy. Neither API has an allow default.
Check current feature state, principal eligibility, placement, policy version and
transactional quotas, and approve only under the consumer's explicit risk policy.
If independent evidence is required and unavailable, reject the claim. The kit does
not provide an Apps in Toss server-side ad verification API.

The retired `contactsViral` share-reward bridge is no longer exported by `ait-rn`.
An ordinary share-sheet result does not prove sharing, a referral, or reward
eligibility. Do not substitute a general share callback for the retired reward
event. App-owned rewards from other eligible sources can still use this ledger.

## Endpoint contract

Authenticate and reject disabled/revoked principals on **all three endpoints**.
Read the principal from the verified session, never from a request body. Rate-limit
issuance and claims. Use server database time; client clocks do not set expiry.

1. `POST /app-rewards/attempts`: accept a placement selector. Resolve its allowed
   source and offer on the server, then call `issue_app_reward_attempt_tx` with a
   mandatory policy closure. Commit before returning the attempt. Persist the ID
   for this account/placement before starting the SDK flow.
2. `POST /app-rewards/attempts/:id/claim`: accept the ID and placement selector.
   Call `claim_app_reward_attempt_tx` with a server policy closure. The helper
   checks ownership, placement and expiry; the closure checks fresh eligibility,
   policy version/amount and quota in the same transaction. Roll back every error.
3. `GET /app-rewards/attempts/:id`: use `find_app_reward_attempt_tx` with the same
   principal and placement. `grantedAt != null` identifies the committed receipt;
   a null value with `expiresAt <= serverNow` is expired, otherwise pending.

The claim returns the original receipt on replay, including after expiry, without
running a new grant policy. Wrong owner/placement returns no record. Pausing new
entry must preserve receipt lookup; ungranted claims still need the current server
gate. Losing a response is a reason to look up this attempt, not issue another one.
An issuance retry can create a second attempt, so issuance/claim quotas must span
attempt IDs and prevent extra rewards for the same eligibility window.

```rust,ignore
// In an authenticated WASM handler. All named app_* checks are consumer policies.
let mut tx = trailbase_guest_common::db::tx()?;
let now = trailbase_guest_common::db::now_ms_tx(&mut tx)?;
let result = trailbase_guest_common::app_rewards::claim_app_reward_attempt_tx(
    &mut tx, &principal_id, &placement, &attempt_id, now,
    |tx, attempt| {
        // Server state/evidence only; no client amount, earned flag or duration.
        app_reward_eligible_tx(tx, &principal_id, attempt, now)
    },
)?; // Any error must roll back the entire transaction.
trailbase_guest_common::db::tx_commit(&mut tx)?;
// Return result. Its ledger entry is already the credit; never grant again here.
```

For a wallet projection, perform it inside that transaction using a unique
`attempt_id` projection marker; repeated claim receipts must not update the balance
again. The simplest reference balance is a sum of joined committed grant/attempt
amounts by owner and unit, minus the app's transactional spending ledger.

## Retiring a legacy share-reward placement

Consumers importing `@trailbase-apps-in-toss-kit/ait-rn/share-reward` or the
former root exports `createAppsInTossContactsViralBridge` and
`runContactsViralReward` must remove those imports and any direct SDK call.
For each affected campaign/placement, disable new attempt issuance and unpaid
claims in the app-owned server policy. Keep the read-only receipt endpoint and
already committed grant rows available under the app's retention policy. Do not
turn off the entire `app-reward` feature if ad or other valid app-owned rewards
still depend on it.

Remove the reward entry button, reward text, `moduleId` configuration, event
handler and reward-only route in the consumer app. Existing referral links can
continue to open a normal destination; route old reward-screen links to a
normal screen or an end notice. After deploying, check that the retired reward
cannot be started or claimed, prior receipts remain readable, and ordinary
sharing, ads and separate promotions still work. A new viral SDK needs its own
reviewed integration and server eligibility evidence before any reward flow is
enabled.

## Retention and validation

Do not prune attempts or grants while a credit, replay, quota or reconciliation can
still depend on them. Principal deletion cascades to these app-owned rows; apply the
app's retention/erasure policy before deleting the principal. Never repurpose this
ledger for Toss IAP, promotion transaction keys or platform payment reconciliation.

Tests run the same Rust orchestration and SQL on SQLite: owner/placement fencing,
expiry, denied policies, transactional quota, duplicate receipt, SQL uniqueness,
rollback with a failed projection and account erasure. They use synthetic data and
do not assert real-device ad evidence. Consumer device checks and independent
eligibility policy remain required before enabling rewards.
