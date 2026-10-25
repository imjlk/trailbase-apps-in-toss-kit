---
npm/@trailbase-apps-in-toss-kit/toss-mtls-client-proxy: patch
---

Serve anonymous-key verification at `POST /internal/apps-in-toss/users/anon-key/verify`, the path `@ait-kit/api-client` 0.6.0 `createTossMtlsHttpClient().anonKeyVerify` calls, in addition to the existing `POST /internal/apps-in-toss/anonymous-key/verify`. Both paths share one handler, response shape and internal bearer requirement; callers previously received `404 NOT_FOUND` from the ait-kit path. Verification still proves key validity only, not caller ownership — public bootstrap must keep using the auth-code exchange route. No env, capability or migration change.
