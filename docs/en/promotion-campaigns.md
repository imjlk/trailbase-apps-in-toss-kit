# Promotion Campaigns

Promotion campaign state is generic. A consumer app can use it for missions,
sharing, referrals, seasonal events, game rewards, onboarding rewards, or any
other feature that needs an operator-managed Toss promotion code and reward
amount.

Use this pattern when product or operations teams need to turn a promotion on or
off without changing app code or redeploying the proxy. If a single static env
promotion is enough, the env fallback may be sufficient.

## Model

Use `templates/trailbase/sql/promotion_campaigns.sql` when TrailBase should own
promotion configuration instead of relying only on proxy environment variables.
Use `templates/trailbase/sql/promotion_reward_ledger.sql` when the app also
wants a standard provider grant ledger. The campaign table stores:

- `feature_key`: app-defined stable key for the promotion feature.
- `provider`: currently `TOSS`.
- `provider_promotion_code`: Toss Console promotion code.
- `reward_amount`: amount sent to Toss for that campaign.
- `status`: operator state such as `DRAFT`, `ACTIVE`, `PAUSED`, `ENDED`, or
  `EXHAUSTED`.
- `starts_at` / `ends_at`: active window in epoch milliseconds. These are
  required before a DB-backed campaign can be moved to `ACTIVE`.
- `budget_limit_amount` / `max_grant_count`: local safety limits before calling
  Toss. `budget_limit_amount` is required for DB-backed `ACTIVE` campaigns;
  `max_grant_count` remains optional.

The env fallback path can run without a configured active window or local budget.
DB-backed campaigns are stricter because operators should make the campaign
window and total local budget explicit before real Toss calls start.

Feature keys are owned by the consumer app. They should be stable and meaningful
to operators, but they do not have to encode the whole business rule. For
example, an app can have one key for a mission reward and another for a share
event; both use the same campaign table shape.

Choose feature keys for people who operate the service. A short, stable key such
as `share_reward` or `onboarding_bonus` is usually easier to maintain than a key
that encodes every eligibility detail.

The shared SQL template keeps a general `feature_key/status` index for mixed
operator views and also adds an `ACTIVE` partial index for the hot lookup path
used before provider grants. Keep active campaign resolution in one app-owned
transaction with the usage check and ledger transition; do not expose provider
promotion codes or raw Toss identifiers to RN clients.

## Env Fallback

Env fallback exists for legacy or local-only flows:

```text
TOSS_PROMOTION_CODE=...
TOSS_PROMOTION_AMOUNT=50
```

For a feature that has any DB campaign row, treat DB campaign state as the source
of truth and ignore env fallback for that feature. If no campaign row exists for
the feature, env fallback can keep older deployments and smoke tests working.

## App Ledger

Campaign configuration is separate from eligibility and provider grant state.
New apps can copy `templates/trailbase/sql/promotion_reward_ledger.sql` as the
starting point for that grant ledger. Existing apps with app-specific ledgers
should add compatible columns with forward migrations instead of replacing
their tables. A ledger should usually store:

- `campaign_id` nullable reference to `promotion_campaigns`.
- app-specific eligibility dimensions, such as user, cycle, mission, or event.
- `reward_amount` copied at eligibility time.
- local status such as `recorded`, `pending`, `success`, `failed`, or
  `cancelled`; apps with their own ledgers can keep app-specific status names.
- unique `provider_request_id`.
- `provider_transaction_key`, `provider_status`, `provider_error_code`,
  `granted_at`, `failed_at`, and `failure_reason`.

Keep this ledger private to app/admin flows unless a consumer explicitly creates
a safe public projection. Never expose Toss promotion codes, raw Toss user keys,
provider request ids, transaction keys, or internal error details in public
Record API views.

TrailBase WASM handlers can use `trailbase_guest_common::promotion_rewards` to
insert idempotent ledger rows, apply normalized provider outcomes, and count
campaign usage with safe table/column identifiers. The app still owns
eligibility, source dimensions, budget policy beyond the shared campaign table,
and any local reward balance updates.

## React Native Claim Client

React Native apps can use
`@trailbase-apps-in-toss-kit/ait-rn/promotion` to call app-owned campaign claim
endpoints with a generic `campaignId`:

```ts
await promotions.claim({
  campaignId: "daily-attendance",
  eligibilityId: "attendance-2026-06-19",
  requestId: "daily-attendance:user-123:2026-06-19",
});
```

The client normalizes common claim statuses but does not know Toss promotion
codes, campaign budgets, raw Toss user keys, or proxy tokens. Treat `campaignId`
as the RN-to-backend contract; the backend resolves that value to campaign
configuration and ledger state before calling the proxy.

## Claim Idempotency

Promotion claims should be idempotent at the app ledger layer.

1. Load the eligible ledger row for the authenticated user.
2. Check the selected campaign is active and has local budget/count capacity.
3. Move the ledger row from `ELIGIBLE` or retryable `FAILED` to `REQUESTED`
   with a conditional update.
4. Store a unique provider request id before calling the proxy.
5. Call the mTLS proxy once for that request id.
6. Persist provider status and error information.

If a retry sees a row already in a committed state such as `pending` or
`success`, return the current ledger state instead of calling the proxy again.
This keeps client retries and multi-device taps from executing the same
promotion twice.

## Operator Flow

1. Create or update a campaign row with a provider promotion code and amount.
2. Move the campaign to `ACTIVE` only after the Toss Console setup is ready.
3. Watch ledger status, provider error codes, grant count, and remaining budget.
4. Pause or exhaust the campaign locally before retrying suspicious provider
   failures.

## Proxy Request

DB-backed consumers should pass campaign values per request:

```json
{
  "providerRequestId": "app-feature:user-or-eligibility-id",
  "promotionCode": "toss-console-promotion-code",
  "amount": 50,
  "tossUserKey": "sealed-user-key-after-unseal"
}
```

`promotionAmount` is accepted as a compatibility alias for `amount`, but new
callers should prefer `amount`.

The proxy returns a normalized `providerErrorCode` when Toss returns an upstream
error code. Consumers should map provider signals conservatively:

- `4112`, `4116`: mark the campaign `EXHAUSTED`.
- `4104`, `4105`, `4108`, `4109`: pause the campaign.
- `4114`: treat as misconfiguration and pause or escalate before retrying.

## Persist the Transaction Key Before Executing

The recommended grant flow stores the provider transaction key in the ledger
before any execute call, so a crash or lost response can never lose the only
handle to the outcome. Use the three-step proxy helpers
(`apps_in_toss_proxy::promotion_reward_prepare`,
`promotion_reward_execute`, `promotion_reward_status`) with the ledger
helpers in `trailbase_guest_common::promotion_rewards`:

1. **Validate and insert** the pending ledger row
   (`insert_promotion_reward_ledger_tx`): user, campaign, amount, source,
   and `provider_request_id` are the idempotency context — the same request
   id with a different user, amount, or campaign is rejected, not merged.
   Never hold this transaction across a network call.
2. **Prepare** (`promotion_reward_prepare`): issues a key and nothing else.
   `ok: true` here only means a key was issued; it is never a grant, and the
   endpoint takes no recipient, so do not attach user-key fields.
3. **Store the key and commit**
   (`store_promotion_transaction_key_tx`): marks the row `PREPARED`. Storing
   the same key again is idempotent; storing a different key is rejected
   (`PROMOTION_TRANSACTION_KEY_CONFLICT`) — an existing key is never
   overwritten. If this commit fails, do not call execute.
4. **Claim execution and commit** (`begin_promotion_reward_execute_tx`):
   atomically moves `PREPARED` → `EXECUTING`. Exactly one worker can hold
   the claim; a second concurrent claim gets `None`. Only a `PREPARED` row
   with a stored key can be claimed, and terminal rows are never re-entered.
5. **Execute** (`promotion_reward_execute`) with the stored key and the
   ledger row's own recipient/amount context — never client-supplied
   amounts, recipients, or keys. The helper rejects a payload without a
   transaction key before any network call.
6. **Apply the response** (`apply_promotion_reward_outcome_tx`) in a fresh
   transaction, or recover a lost response with
   `promotion_reward_status` and the stored key. The statement only matches
   the row's own `provider_request_id`, never overwrites a stored key with
   a different one, and a confirmed `success` row cannot be reverted by a
   late pending/unknown response.

`SUBMITTED` (execute accepted, unconfirmed) and `UNKNOWN` (outcome could not
be determined — including `ok:false` UNKNOWN envelopes) both keep the ledger
row `pending` with no fabricated `granted_at`/`failed_at`; they are
neither a confirmed grant nor a confirmed failure. Rows whose execute
started but whose outcome is unknown surface through
`promotion_reward_ledgers_awaiting_recovery_tx` (`EXECUTING`); their
recovery is a status lookup with the stored key first — do not re-execute
on that signal, and do not assume same-key re-execution is safe without
provider documentation. A restart after step 3 but before step 4 resumes at
step 4 with the same stored key (no second prepare, no duplicate grant).

The legacy single-call grant endpoint and helper remain supported, but they
cannot guarantee the key was persisted before execution — treat that flow's
lost-response cases accordingly. The proxy's status mapping keeps
`UNKNOWN` as `PENDING` for legacy ledger consumers.

## Reconcile an Existing Grant

Persist every returned `providerTransactionKey` in the promotion ledger. Use
`apps_in_toss_proxy::promotion_reward_status` with the same campaign, recipient,
request id, and transaction key to call
`POST /internal/apps-in-toss/promotion/reward/status`. The endpoint requires an
existing key and only queries Toss execution-result; it cannot allocate a key or
execute another grant. Apply the result to the original ledger row.

A transport failure during the original grant can lose the key before the caller
persists it. That case requires operator/provider reconciliation; do not retry
with a new key. The status endpoint does not make the combined original grant
flow atomic across a network interruption.

See [Verified anonymous identity, dispatch, and recovery](anonymous-identity.md).
