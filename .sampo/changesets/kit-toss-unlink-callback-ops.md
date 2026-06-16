---
npm/@trailbase-apps-in-toss-kit/trailbase-runtime: patch
cargo/trailbase-guest-common: patch
---

Add shared Toss Login unlink callback guards for TrailBase apps. Consumers can validate callback
Basic Auth and allowed methods through the runtime production checks, use an entrypoint guard in
production, and derive callback `toss_user_key_hmac` values through `toss_unlink` helpers without
logging raw Toss user keys.
