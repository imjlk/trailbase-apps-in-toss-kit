---
npm/@trailbase-apps-in-toss-kit/toss-mtls-client-proxy: minor
npm/@trailbase-apps-in-toss-kit/trailbase-runtime: minor
---

Expose additive proxy version and adapter-capability metadata on authenticated health
responses. Use the Release Doctor proxy-capabilities check before adopting anonymous
verification, promotion recovery or other new adapter contracts. Legacy health responses
without metadata require a proxy upgrade or an explicitly optional transitional check.

Pass the internal URL/token through environment variables. Checks use bounded read-only
health requests, reject redirects and omit secrets/upstream response bodies from reports.
Capabilities describe this binary, not upstream reachability, configured campaign access
or user eligibility. No SQL migration is required; publish and select the new proxy image
before making capability checks mandatory.
