---
npm/@trailbase-apps-in-toss-kit/ait-web: minor
---

Add a private source-consumed WebView SDK 3 adapter for SDK Storage, Toss login,
verified-anonymous bootstrap input, functional notification agreement, one-time
and subscription purchases, pending/status/completion queries and sharing.
Consumers own @apps-in-toss/web-framework >=3.4.0 <4. RN consumers remain on ait-rn.

The adapter uses current namespaces, availability checks and bounded event cleanup;
backend grant callbacks must explicitly return true. There is no automatic mock,
localStorage migration, account reassignment or client-side payment verification.
Preserve existing SDK Storage keys, check real console origins/device behavior, and
reconcile original order IDs after timeout before another purchase.
