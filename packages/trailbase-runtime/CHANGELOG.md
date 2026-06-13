# @trailbase-apps-in-toss-kit/trailbase-runtime

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
