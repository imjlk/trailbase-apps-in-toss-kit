---
npm/@trailbase-apps-in-toss-kit/toss-mtls-client-proxy: patch
npm/@trailbase-apps-in-toss-kit/ait-rn: patch
npm/@trailbase-apps-in-toss-kit/trailbase-client: patch
---

Refresh the RN SDK reference to 2.10.10, pin Bun 1.4.2, and check adapter sources
against the installed SDK types in CI. Upgrade the proxy to @ait-kit 0.2.0 while
preserving authenticated generic mTLS requests, the documented Smart Message
recipient header, and legacy partial-delivery failure fields. Anonymous message
requests use x-anon-key exclusively; consumers still enforce notification agreement.

Copy the updated Compose template to adopt the already released proxy 0.1.12.
Deploy the next Sampo-generated proxy image to use these source changes. No
TrailBase schema migration or minimum supported server change is required.
