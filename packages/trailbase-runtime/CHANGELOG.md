# @trailbase-apps-in-toss-kit/trailbase-runtime

## 0.2.0 — 2026-05-22

### Minor changes

- [3395991](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/339599143fcbf386856688c3a0af861e3026c605) Add shared TrailBase runtime helpers, production env validation, local dev port
  resolution, and React Native client adapter utilities for consumer apps.

  This also hardens the shared helpers for reuse across more apps by preserving
  explicit local URL ports, serializing JSON request bodies, passing XHR SSE
  headers, and surfacing XHR SSE HTTP failures as TrailBase errors. — Thanks imjlk!

## 0.1.0

- Initial private runtime helper package.
