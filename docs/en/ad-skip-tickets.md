# Ad skip tickets

`trailbase_guest_common::ad_skip_tickets` keeps an app-owned balance of tickets that
each skip one full-screen ad, with once-only grants and idempotent redemptions.
`@trailbase-apps-in-toss-kit/ait-rn/ad-skip` keeps the client side of a redemption
recoverable. Copy `templates/trailbase/sql/ad_skip_tickets.sql` into a new consumer
migration and rebuild the WASM guest. Keep every table private: no Record API
collection or view may expose them.

A ticket is an in-app right to skip one ad. It is not transferable, sellable or
convertible to cash or Toss points, and it never uses `promotion_reward_ledger`.
Redeeming one creates no SDK ad event, impression, reward callback or ad session, and
must not count toward ad impression, completion, revenue, daily cap or cooldown
metrics. Record the chosen path (ad, ticket or free) separately when measuring use.

## Tables

| Table | Role |
| --- | --- |
| `ad_skip_ticket_wallets` | Server balance per account. `balance >= 0`. Deleted with the account. |
| `ad_skip_ticket_grants` | One row per granted cause period. Unique per subject, cause and period. |
| `ad_skip_opportunities` | One resolution per ad prompt: `AD`, `TICKET` or `FREE`. |
| `ad_skip_ticket_redemptions` | Receipts keyed by `(user_id, request_id)`. A partial unique index allows one charge per opportunity. |

Grants store `subject_hash`, a domain-separated SHA-256 of a stable app-scoped
identity (see [reward-cohorts.md](reward-cohorts.md)). It outlives the account, so
deleting and re-joining cannot earn the same day or cycle again. The balance itself is
forfeited on account erasure, matching the usual withdrawal notice. Grant rows whose
period can no longer be earned may be pruned under the app's retention policy.

## Grants

Call `grant_ad_skip_tickets_tx` in the same transaction that records the qualifying
server event, such as an accepted check-in. There is no separate "claim tickets"
endpoint. Tickets must not depend on a Toss promotion call: a failed, exhausted or
unconfigured promotion leaves the attendance and its tickets in place.

```rust,ignore
// Inside an authenticated check-in transaction.
use trailbase_guest_common::ad_skip_tickets::{AdSkipGrant, grant_ad_skip_tickets_tx};
let daily_grant = AdSkipGrant {
    subject_key: &scoped_identity_hmac, // stable across reinstalls and re-joins
    cause: "daily_attendance",
    period_start: kst_day,
    period_end: kst_day,
    quantity: 1,
    policy_version: "reward-v1",
};
grant_ad_skip_tickets_tx(&mut tx, &user_id, &daily_grant, now)?;
if let Some((start, end)) = cycle_completed_now {
    grant_ad_skip_tickets_tx(&mut tx, &user_id, &AdSkipGrant {
        cause: "streak_bonus", period_start: start, period_end: end, quantity: 3,
        ..daily_grant
    }, now)?;
}
```

- `Granted` adds the quantity. `AlreadyGranted` means this subject already has the
  exact cause period (a retry, a concurrent request or an earlier account) and changes
  nothing, even if the configured quantity changed. `Overlapping` means another
  period of the same cause overlaps; nothing is granted.
- Grant only for events that happen on or after the ticket start time. Do not replay
  historical attendance to backfill grants. A cycle that started before the start
  time but completes after it can earn its bonus once.
- A day restored by watching an ad earns no daily ticket. A cycle completed through a
  restore can earn its bonus once. Bonuses and daily grants are separate causes, so a
  seventh-day check-in can grant both.

## Ad opportunities

An opportunity is one ad prompt, named by an `opportunity_key` the consumer derives
on the server, for example `cycle:42` for a generation ad cycle. A later prompt must
get a new key. Each opportunity has at most one resolution.

- A completed rewarded ad calls `claim_ad_opportunity_tx(..., AdOpportunityResolution::Ad, ad_session_id, now)`.
  A free continuation that settles the prompt (for example no-fill) uses `Free`.
- On `AlreadyResolved`, skip that path's effect. A late ad callback after a ticket
  resolved the same prompt must not open a new ad interval.
- Only redemption records `Ticket`.

## Redemption

`redeem_ad_skip_ticket_tx` runs in this order, all in one transaction:

1. A known `request_id` returns its original receipt with `replayed: true`. The same ID
   with a different placement, key or context fails with `AD_SKIP_REQUEST_CONFLICT`.
2. A placement outside `allowed_placements` fails with `AD_SKIP_PLACEMENT_NOT_ALLOWED`
   before any change. Never list an attendance-restore placement. An empty list pauses
   redemption while keeping balances and grants.
3. An already resolved opportunity returns `ALREADY_RESOLVED` with `consumed: 0` and the
   original resolution, so the client can map it to the same effect.
4. The read-only `evaluate` closure decides. `Free` (no ad is due now, for example the
   free quota or a pressure limit) writes a no-charge receipt and does not resolve the
   opportunity. `Due` continues. Return an error instead when the feature itself cannot
   run (for example a daily generation limit), so nothing is charged.
5. An empty balance fails with `AD_SKIP_INSUFFICIENT_BALANCE` before `resolve` runs.
6. `resolve` advances the consumer's ad state and returns true only if this call changed
   the current opportunity (for example exactly one updated cycle row). Otherwise the
   call fails with `AD_SKIP_OPPORTUNITY_STALE` and nothing is charged.
7. The opportunity resolution, the conditional debit and the receipt are written last.

Roll back on every error. Do not create a fake `userEarnedReward` or call the ad
completion endpoint for a ticket.

| Code | Status | Meaning |
| --- | --- | --- |
| `INVALID_AD_SKIP_REQUEST` | 400 | Malformed request ID, placement, key or context |
| `AD_SKIP_PLACEMENT_NOT_ALLOWED` | 403 | The placement does not accept tickets |
| `AD_SKIP_REQUEST_CONFLICT` | 409 | The request ID was used for another choice |
| `AD_SKIP_INSUFFICIENT_BALANCE` | 409 | No ticket available; nothing changed |
| `AD_SKIP_OPPORTUNITY_STALE` | 409 | The prompt is no longer current; nothing charged |

Request IDs are 16-128 characters of `A-Z a-z 0-9 _ -`. Keys, references and the
optional context use `A-Z a-z 0-9 . _ : -`. Put only an opaque continuation value in
the context, such as the original feature request ID, never identities or tokens.
Return the receipt fields (`receiptId`, `resolution`, `consumed`, `balance`,
`replayed`, `opportunity`, `context`) to the client; the serde output already uses
these camelCase names.

## Client

```ts
import {
  createAdSkipRedemptionClient,
  createAdSkipRedemptionController,
  resolveAdSkipChoice,
} from "@trailbase-apps-in-toss-kit/ait-rn/ad-skip";

const client = createAdSkipRedemptionClient({ baseUrl, getAuthHeaders, redeemEndpoint: "/api/app/v1/ad-skips/redeem" });
const adSkips = createAdSkipRedemptionController({ redeem: client.redeem, storage, storageKey: "app.adSkips" });
adSkips.setBalance(status.adSkipBalance); // from the shared status response

const outcome = await adSkips.redeem({ placement: "generation_continue", opportunityKey, context: generationRequestId });
if (outcome.status === "resolved") {
  await adSkips.applyEffectOnce(outcome.receipt, () => generationCounter.continued());
  // then continue the original feature with the original request ID
}
```

- The controller persists the request ID before sending, retries timeouts, network
  errors, 401/408/425/429 and 5xx with the same ID up to `maxAttempts`, and keeps an
  unknown result pending across restarts. Call `retryPending()` on startup or for a
  manual "check again". A closed screen or cancelled request is not a refund.
- `isBlocked(placement, key)` stays true while a result is on the wire or unknown;
  block both a new ticket request and an ad for that opportunity, not the whole app.
- `applyEffectOnce` persists the receipt's effect key before running the effect, so
  a retried response or restart never draws a new ad interval twice.
- `resolveAdSkipChoice` gives the button state: no ticket choice for placements
  outside the allowlist (for example an attendance restore), disabled while loading,
  checking or busy, and "0 left" without disabling the ad choice.
- Do not auto-redeem. A user who chose to watch an ad keeps that choice even if the ad
  fails; a ticket chosen first never calls the ad SDK and never preloads an ad.

## Validation

Kit tests run the Rust orchestration and SQL on SQLite: once-only daily and streak
grants, overlap and re-join protection, erasure, replay and conflicting request IDs,
blocked placements, empty balances, stale consumer state with rollback, free and
already resolved opportunities, ticket/ad races and constraint backstops. Client tests
cover persistence, retries with one ID, restarts, rejection and once-only effects.
Consumers still need device checks of their prompts and counters.
