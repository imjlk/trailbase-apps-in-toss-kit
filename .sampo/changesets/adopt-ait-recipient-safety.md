---
npm/@trailbase-apps-in-toss-kit/toss-mtls-client-proxy: patch
---

Adopt api-core/api-client 0.5.1 for shared promotion failure-text privacy and safe integer recipient validation. Remove the proxy's duplicate recursive redactor so a short recipient equal to a provider error code cannot corrupt that code. Existing v2 ledger schemas remain compatible; fractional or unsafe numeric recipient IDs must be replaced with exact strings before dispatch.
