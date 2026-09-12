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

The Compose template keeps the already released proxy 0.1.12 as a baseline; that
image does not contain these source changes. After the next Sampo-generated proxy
image is published, update the consumer-owned image pin before using the new behavior.
No TrailBase schema migration or minimum supported server change is required.

Forward IAP lookups no longer promote requested SKUs into provider evidence. Paid
responses without a provider SKU fail with UNVERIFIED_IAP_ORDER; retry verification
before granting products. Explicit stub mode remains available for local tests.
