# @trailbase-apps-in-toss-kit/ait-web

## 0.1.1 — 2026-09-13

### Patch changes

- Updated dependencies: trailbase-client (npm)@1.1.1

## 0.1.0 — 2026-09-12

### Minor changes

- [abca25d](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/abca25d969d9ffabd37a6fe71f4ab724fad0d281) Add a private source-consumed WebView SDK 3 adapter for SDK Storage, Toss login,
  verified-anonymous bootstrap input, functional notification agreement, one-time
  and subscription purchases, pending/status/completion queries and sharing.
  Consumers own @apps-in-toss/web-framework >=3.4.0 <4. RN consumers remain on ait-rn.
  
  The adapter uses current namespaces, availability checks and bounded event cleanup;
  backend grant callbacks must explicitly return true. There is no automatic mock,
  localStorage migration, account reassignment or client-side payment verification.
  Preserve existing SDK Storage keys, check real console origins/device behavior, and
  reconcile original order IDs after timeout before another purchase. — Thanks @imjlk!

