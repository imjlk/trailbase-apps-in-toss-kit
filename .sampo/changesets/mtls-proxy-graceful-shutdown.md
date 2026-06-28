---
npm/@trailbase-apps-in-toss-kit/toss-mtls-client-proxy: patch
---

Add graceful shutdown handling for the mTLS proxy, enable init in the reusable Compose template, and
document the shutdown behavior so local recreates do not wait for Docker's default stop grace period.
