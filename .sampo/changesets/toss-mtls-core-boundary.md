---
npm/@trailbase-apps-in-toss-kit/toss-mtls-client-proxy: patch
---

Extract the Toss mTLS adapter logic behind private runtime-neutral core and HTTP client workspace packages, align the core mTLS port with the `request(url, init) => Response` shape, and preserve the proxy HTTP API, Docker image behavior, and certificate boundary.
