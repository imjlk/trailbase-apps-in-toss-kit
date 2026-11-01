# Reward cohorts and point eligibility

`trailbase_guest_common::reward_cohorts` limits point rewards by who the user is and
when they started: existing users keep points until a fixed grace end, new users get
points for their first N local days, and every other app-owned reward keeps working.
It also snapshots each point condition when it is met, so a later campaign or window
change never rewrites it. Copy `templates/trailbase/sql/reward_subject_cohorts.sql`
and `templates/trailbase/sql/promotion_reward_eligibilities.sql` (which needs
`promotion_campaigns.sql`) into new consumer migrations. Keep both tables private.

Server database time is the only authority. Never decide a cohort, window, amount or
period from a device clock, local storage, a client "new user" flag or a client
amount. Every end instant is exclusive.

## Policy

```rust,ignore
use trailbase_guest_common::reward_cohorts::RewardCohortPolicy;
// KST days; a subject first seen on day 1 earns new points until day 8 00:00.
let policy = RewardCohortPolicy::kst("reward-v1", new_user_cutover_at, legacy_points_earn_ends_at, 7);
policy.validate()?;
```

| Field | Meaning |
| --- | --- |
| `new_user_cutover_at` | Subjects first seen before it are `LEGACY`, at or after it `WELCOME` |
| `legacy_points_earn_ends_at` | Exclusive end of new point eligibility for every legacy subject |
| `welcome_point_days` | Local days of welcome eligibility, counting the first day as day 1 |
| `utc_offset_ms` | Fixed day offset; `kst()` uses `KST_OFFSET_MS` |

Leave the policy inactive until every instant is decided; do not default to the
deployment date. A grace period should start when the notice actually starts, never
from a past date the app could not announce. Changing `legacy_points_earn_ends_at`
applies to all legacy subjects; a welcome subject keeps the end registered for it.

## Subjects

`register_reward_subject_tx(tx, subject_key, first_seen_at, &policy, now)` stores one
row per subject and returns it. The first registration wins: later visits, a recreated
profile, a reinstall, a new policy version or a new campaign never move or restart it.

- `subject_key` must be stable across reinstalls and account re-creation, such as a
  scoped HMAC of the verified anonymous identity. Only `reward_subject_hash(subject_key)`
  is stored. Never pass or log a raw Toss user key, and never return the hash.
- Pass the earliest verifiable first use, for example the original profile
  `created_at`, never the first request after an update. Register existing profiles
  lazily (bootstrap or status) or from a guest job before the cutover, not from a
  migration timestamp. A user whose history was already deleted cannot be recovered;
  record that limit instead of inventing an earlier time.
- The table has no `_user` reference, so withdrawal and re-joining cannot open a new
  welcome window. Apply the app's retention policy explicitly.

`point_window(&policy, now)` returns `LEGACY_GRACE`, `WELCOME` or `ENDED` with the
exclusive `endsAt`. Use it for status responses; keep every other reward, attendance
and ad field in the status response when points have ended.

## Eligibility snapshots

When the server accepts the event that meets a point condition (a check-in or restore
commit), call `record_point_eligibility_tx` in that transaction with the campaign the
server would choose now. The provider code and amount are copied from that
`promotion_campaigns` row in the same statement.

```rust,ignore
let record = record_point_eligibility_tx(&mut tx, &user_id, &subject, &policy, &PointEligibilityInput {
    reward_kind: "attendance_weekly",
    period_start: cycle_start,
    period_end: cycle_end,
    campaign_id: &campaign.id,
    earned_at: now,                     // the commit time, not the attendance day
    claim_deadline_at: local_day_start(cycle_end + 7, KST_OFFSET_MS),
    max_per_subject: Some(1),           // e.g. one welcome streak reward
}, now)?;
```

| Outcome | Meaning |
| --- | --- |
| `RECORDED` | New snapshot; the amount is the campaign's current amount |
| `EXISTING` | This owner already has this exact period; returned unchanged |
| `WINDOW_CLOSED` | `earned_at` is at or after the subject's window end; nothing recorded |
| `OVERLAPPING` | The subject already has this or an overlapping period elsewhere |
| `LIMIT_REACHED` | `max_per_subject` snapshots already exist for this kind |

- A snapshot met inside the window survives the window's end. Its first claim stays
  open until `claim_deadline_at`, so a streak completed on day 7 can still be claimed
  on day 8. A restore after the window cannot create a new eligibility for a past
  period because the window check uses `earned_at`.
- A first claim uses the stored campaign, provider code and amount. Do not answer
  `CAMPAIGN_CHANGED` just because a newer campaign is active, and never swap in another
  campaign's amount. Still check the stored campaign's budget and provider state and
  report exhaustion or an ended promotion explicitly.
- Recording reserves no budget and guarantees no payment. Show "condition met" with
  the campaign state, not "credited", until the provider grant succeeds.
- Link the first claim with `mark_point_eligibility_claimed_tx(tx, user, id, ledger_id, now)`
  in the transaction that inserts the promotion ledger row. The same ledger ID replays;
  another conflicts; an unclaimed snapshot past its deadline fails with
  `POINT_ELIGIBILITY_CLAIM_EXPIRED`. Status checks and retries of an existing ledger row
  are not first claims and must not be blocked by the window or the deadline.
- `list_point_eligibilities_tx` returns an owner's recent snapshots for a history view.
  The serialized form omits the provider promotion code.

## Operating notes

- Ending a cohort's window is a server eligibility limit. It does not end the console
  promotion that other cohorts may still use. Before ending or replacing a console
  promotion, check unclaimed snapshots, open first-claim deadlines and pending ledger
  rows, and keep campaign rows referenced by snapshots.
- A global promotion kill switch is not a cohort limit: it usually also stops pending
  claims from being rechecked. Keep app-owned rewards such as ad skip tickets
  independent of it.
- Snapshots keep `subject_hash` and set `user_id` to `NULL` on account deletion, so a
  re-joined identity sees `OVERLAPPING` for a period it already earned.

Kit tests cover KST day boundaries, first-day counting and the exclusive day-8 end,
legacy grace changes, first registration wins, campaign amount changes after a
snapshot, window and overlap rejection, per-subject caps, claim linking and deadlines,
and account erasure followed by a re-join.
