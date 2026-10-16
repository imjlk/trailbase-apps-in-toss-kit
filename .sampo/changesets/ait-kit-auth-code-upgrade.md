---
cargo/trailbase-guest-common: minor
npm/@trailbase-apps-in-toss-kit/ait-web: minor
npm/@trailbase-apps-in-toss-kit/ait-rn: patch
npm/@trailbase-apps-in-toss-kit/toss-mtls-client-proxy: minor
---

Adopt published @ait-kit/sdk 0.7.0 and api-core/api-client 0.6.0. WebView consumers on official SDK 3.6+ can request fresh anonymous authentication codes and exchange them once through the private proxy and Rust helper before official TrailBase login. The old key-verification route only checks key validity and must not authenticate an untrusted caller. Require proxy capability anonymous-key.exchange-auth-code before adoption; keep codes and raw keys out of storage, logs and public responses. Existing identity HMAC seeds and account mappings are preserved; no schema migration is required for code exchange. Older SDK peers retain existing APIs but this opt-in method returns unsupported without falling back to a hash or login.
