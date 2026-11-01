---
cargo/trailbase-guest-common: minor
npm/@trailbase-apps-in-toss-kit/ait-rn: minor
---

Add app-owned ad skip ticket and reward cohort helpers with the `ait-rn/ad-skip` client. Adopting them requires copying the new `ad_skip_tickets.sql`, `reward_subject_cohorts.sql` and `promotion_reward_eligibilities.sql` templates into consumer migrations; existing consumers need no change.
