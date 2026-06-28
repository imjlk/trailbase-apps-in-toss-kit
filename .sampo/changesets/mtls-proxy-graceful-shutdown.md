---
npm/@trailbase-apps-in-toss-kit/toss-mtls-client-proxy: patch
---

Add graceful shutdown handling for the mTLS proxy, enable init and a request-safe stop grace period in
the reusable Compose template, and document how to preserve in-flight Toss requests during container
recreates.
