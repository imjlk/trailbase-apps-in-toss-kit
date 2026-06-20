# @trailbase-apps-in-toss-kit/trailbase-runtime

## 0.2.4 — 2026-06-20

### Patch changes

- [cf5ded4](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/cf5ded486651742a2cb9a360218461f4dd65ec2c) Add shared AppsInToss functional ledger helpers and SQL templates for Smart Message outbox,
  promotion reward grants, and IAP order/grant persistence. — Thanks @imjlk!
- [159fc6d](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/159fc6d6a16d68c59199d6c846270c381975969c) Add an optional TrailBase analytics multi-db template, smoke check, runtime migration copy support
  for database-specific migration directories, and Rust helpers for inserting analytics event batches. — Thanks @imjlk!

## 0.2.3 — 2026-06-16

### Patch changes

- [942e06c](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/942e06c83ddd2018a6fa42b6192e4bb85b0ddab1) Add shared Toss Login unlink callback guards for TrailBase apps. Consumers can validate callback
  Basic Auth and allowed methods through the runtime production checks, use an entrypoint guard in
  production, and derive callback `toss_user_key_hmac` values through `toss_unlink` helpers without
  logging raw Toss user keys. — Thanks @imjlk!

## 0.2.2 — 2026-06-13

### Patch changes

- [7eed7d8](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/7eed7d83af8e08fd13d15d747edee97bca67da8c) Add shared mTLS certificate-pair detection for mounted proxy certificate directories, explicit
  mTLS certificate path validation aligned with proxy certificate precedence, and comment-aware
  scoped consumer template drift checks for larger Compose and env files. — Thanks @imjlk!

## 0.2.1 — 2026-06-05

### Patch changes

- [b52b2e3](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/b52b2e320c1020dfff6d606f728cf01921c154f2) Detect Docker-published host ports when resolving local development ports so
  consumer fresh-start helpers can automatically move to the next available port. — Thanks @imjlk!

## 0.2.0 — 2026-05-22

### Minor changes

- [3395991](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/339599143fcbf386856688c3a0af861e3026c605) Add shared TrailBase runtime helpers, production env validation, local dev port
  resolution, and React Native client adapter utilities for consumer apps.

  This also hardens the shared helpers for reuse across more apps by preserving
  explicit local URL ports, serializing JSON request bodies, passing XHR SSE
  headers, and surfacing XHR SSE HTTP failures as TrailBase errors. — Thanks imjlk!

## 0.1.0

- Initial private runtime helper package.
