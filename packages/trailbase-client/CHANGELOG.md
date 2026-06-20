# @trailbase-apps-in-toss-kit/trailbase-client

## 0.5.1 — 2026-06-20

### Patch changes

- [1f53594](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/1f535944e6d7e3c6d0416bedc7e640e03bb49faa) Fix the buffered analytics sink return path so strict consumer TypeScript
  projects can typecheck the shared source package. — Thanks @imjlk!

## 0.5.0 — 2026-06-20

### Minor changes

- [9f7cda2](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/9f7cda2e8cac8ea1d4fb43ee6c2aa9971e266b8f) Add bootstrap-controlled analytics sink helpers for AppsInToss metric logging, plus a framework-typed `ait-rn/analytics` bridge. — Thanks @imjlk!

## 0.4.2 — 2026-06-19

### Patch changes

- [24695d2](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/24695d2cfcd7efa40b804dc432543255f9e93754) Add React Native Apps in Toss notification agreement, functional-message backend,
  and promotion campaign claim helpers. Keep the default promotion claim result to
  public campaign status fields while allowing apps to supply their own
  `normalizeResponse` for internal/admin projections. Mark the older TrailBase
  client notification agreement helper as deprecated for compatibility. — Thanks @imjlk!

## 0.4.1 — 2026-06-16

### Patch changes

- [a2f2362](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/a2f2362bb8ea239b218a6d21457dfa9c00902296) Add an Apps in Toss Storage-backed `KeyValueStorage` adapter for React Native and WebView mini-apps.
  Consumers can inject the official `Storage` bridge for production session persistence while keeping
  memory or localStorage fallbacks limited to local tests. — Thanks @imjlk!

## 0.4.0 — 2026-06-09

### Minor changes

- [2ee561a](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/2ee561a09675477a9cc97d9677a71bf90cc62f50) Add a configurable analytics router for TrailBase detailed analytics and AppsInToss console analytics integration. — Thanks @imjlk!

### Patch changes

- [07da898](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/07da8988ad6037bd0507dc02d6050d3fa7496f68) Add a dedicated AppsInToss client adapter subpath and normalize notification
  agreement SDK results for TrailBase functional-message consent storage without
  forwarding raw SDK event payloads. — Thanks @imjlk!

## 0.3.1 — 2026-06-08

### Patch changes

- [a3435c6](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/a3435c629c976c652cf29c2b5953f8b520eb54d0) Preserve the AppsInToss SDK-provided sandbox referrer casing when normalizing
  Toss Login results so backend proxy and forward flows can exchange the original
  one-time authorization code reliably. — Thanks @imjlk!

## 0.3.0 — 2026-06-05

### Minor changes

- [6971577](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/69715775ffe171cf83dbbe41a6f36c6b938154df) Add shared Toss identity store helpers, configurable unlink callback parsing/auth, DB-backed promotion campaign utilities with explicit env fallback control, and Apps in Toss login adapter/error normalization helpers. — Thanks @imjlk!
- [8c58212](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/8c582121a121cfcfa9abed3436d95c77f39ff5dc) Expose TanStack React DB primitives from the TrailBase client adapter and keep
  the React DB runtime dependency pinned inside the kit for submodule consumers. — Thanks @imjlk!

## 0.2.0 — 2026-05-22

### Minor changes

- [3395991](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/339599143fcbf386856688c3a0af861e3026c605) Add shared TrailBase runtime helpers, production env validation, local dev port
  resolution, and React Native client adapter utilities for consumer apps.

  This also hardens the shared helpers for reuse across more apps by preserving
  explicit local URL ports, serializing JSON request bodies, passing XHR SSE
  headers, and surfacing XHR SSE HTTP failures as TrailBase errors. — Thanks imjlk!

## 0.1.0

- Initial private TrailBase client helper package.
