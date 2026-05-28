---
cargo/trailbase-guest-common: patch
cargo/trailbase-toss-identity: patch
---

Separate functional Smart Message `templateSetCode` from the notification agreement SDK
`templateCode`, add a shared helper for persisting `requestNotificationAgreement` results, and
gate user-requested functional alerts against the stored agreement code before dispatch.
