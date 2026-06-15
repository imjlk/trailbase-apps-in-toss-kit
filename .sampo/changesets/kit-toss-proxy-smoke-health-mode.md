---
npm/@trailbase-apps-in-toss-kit/toss-mtls-client-proxy: patch
---

Add `--health-only`, `--full`, and expected-mode checks to the reusable Toss mTLS proxy smoke
script. The default mode now verifies forward proxy health for production pre-QA, while full adapter
payload smoke tests stay available only for local stub environments via `--full`.
