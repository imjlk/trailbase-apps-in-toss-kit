---
npm/@trailbase-apps-in-toss-kit/toss-mtls-client-proxy: patch
---

The proxy image now builds on `oven/bun:1.4.5-alpine` instead of `1.4.2-alpine`. Proxy routes, environment variables, and response shapes are unchanged. Consumers that pin an exact image tag pick up the new base by moving to this release's tag.
