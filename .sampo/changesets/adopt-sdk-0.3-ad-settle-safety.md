---
npm/@trailbase-apps-in-toss-kit/ait-rn: minor
npm/@trailbase-apps-in-toss-kit/ait-web: minor
---

Adopt @ait-kit/sdk 0.3.0 (exact pin) and harden local ad-flow settlement.

- `@ait-kit/sdk` moves from `^0.2.0` to `0.3.0` in `ait-rn` and `ait-web`.
  The SDK's peer floor raises the RN minimum to
  `@apps-in-toss/framework@>=2.10.10`: the `ait-rn` peer bound and the exact
  `framework-min-supported` fixture moved from 2.5.0 to 2.10.10 together, so
  `bun run packages:typecheck:minimum` now compiles against the same reviewed
  pin. WebView consumers keep `>=3.4.0 <4`. Consumers running older RN
  frameworks must upgrade before taking this kit version.
- Local full-screen ad cleanup can no longer strand a pending promise: show
  and injected-load settle paths now resolve/reject before running SDK
  listener cleanup, and cleanup runs once, best-effort — a throwing cleanup
  never replaces the settled result (matching the existing IAP and
  share-reward behavior).
- Default-loader delegation (RN login, anonymous key, ad load, IAP
  purchases and pending orders; web identity, storage, share) is now covered
  by dedicated tests that mock the official SDK module instead of injecting
  replacement functions, including immediate retry after a failed ad load,
  load-then-show, IAP order-id mismatch, duplicate grant callbacks, and
  storage failure propagation. Real Toss app verification remains a
  consumer responsibility.
- Web share results map the SDK 0.3.0 `completed` status (0.2.x `closed`)
  to call completion only; only `failed` rejects.
