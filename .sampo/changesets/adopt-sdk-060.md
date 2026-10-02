---
npm/@trailbase-apps-in-toss-kit/ait-rn: patch
npm/@trailbase-apps-in-toss-kit/ait-web: patch
---

Adopt the published @ait-kit/sdk 0.6.0 in both frontend adapters and document explicit, bounded SDK call diagnostics. Consumers with a direct SDK dependency should pin the same version. Diagnostics remain opt-in and do not change login, sharing, rewards, or deployment settings; no schema migration is required.
