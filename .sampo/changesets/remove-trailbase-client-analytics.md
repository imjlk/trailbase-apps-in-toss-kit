---
npm/@trailbase-apps-in-toss-kit/trailbase-client: major
npm/@trailbase-apps-in-toss-kit/ait-rn: patch
---

Remove the `trailbase-client/analytics` public surface and keep the shared analytics router, buffered sink, sanitizer, backend batch client, and AppsInToss SDK bridge under `ait-rn/analytics`. The deprecated notification agreement helper has also been removed from `trailbase-client/apps-in-toss`; React Native consumers should use `ait-rn/notifications`.
