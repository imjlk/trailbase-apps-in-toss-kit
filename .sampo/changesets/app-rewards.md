---
cargo/trailbase-guest-common: minor
---

Add server-issued app-owned AD/SHARE reward attempts, mandatory server offer and
eligibility policies, owner/placement-scoped receipt lookup and atomic once-only
local credits. SDK events and attempt IDs are not server evidence of viewing or
sharing; consumers must supply an explicit eligibility and quota policy.

Copy app_reward_attempts.sql as a new private migration and rebuild WASM guests.
A grant ledger row is the credit itself: keep optional balance projections in the
same transaction and never issue an external payment after committing it. Preserve
receipt lookup during pauses and reconcile lost responses with the original ID.
These helpers do not manage platform-paid rewards or Toss promotion payments.
