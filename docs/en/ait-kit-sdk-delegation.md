# SDK Operation Delegation to @ait-kit/sdk

The `ait-rn` and `ait-web` packages now delegate their common Apps in Toss
SDK plumbing to [`@ait-kit/sdk`](https://www.npmjs.com/package/@ait-kit/sdk)
instead of reimplementing module acquisition, event settle-once handling,
deadline budgets, and cleanup locally. TrailBase keeps what it owns: the
public API surface, TrailBase server integration, session bootstrap, and
storage-key compatibility.

## What is delegated

| Domain | RN (`@ait-kit/sdk/rn`) | Web (`@ait-kit/sdk/web`) |
|---|---|---|
| Login (`appLogin`) | Default path (no injected function) | — (see boundary below) |
| Anonymous key lookup | Default path (no injected function) | `anonymousHash()` lookup |
| Storage | `createAppsInTossSdkStorageBridge()` helper | `storage.*` operations |
| Full-screen ad load | Default path (no injected function) | — (ads are RN-only) |
| IAP purchases + pending orders | Default path (no injected `IAP` module) | — (see boundary below) |
| Share link / share sheet | — | `createShareLink` / `share` |

"Default path" means the production flow when no replacement function or
module is injected. Injected seams (`appLogin`, `getAnonymousKey`,
`loadFullScreenAd`, `IAP`, …) keep the local flow: they are test/replacement
seams whose synchronous registration and precise error taxonomies are part of
this package's public contract, and the shared adapter always routes through
its own async loader.

## What stays in this repository (and why)

- **Ad show flows** — interstitial completion heuristics, event timelines,
  and timestamps are TrailBase policy with no shared-adapter equivalent.
- **IAP product list / subscription info / grant completion** — plain
  promise calls with TrailBase validation; no event-flow duplication.
- **Web login / notifications / purchases** — their pinned TrailBase
  contracts intentionally diverge from the shared adapters: login passes
  unknown future `referrer` strings through to the backend unchanged (the
  adapter rejects non-enum referrers), notification agreement fails fast
  with `INVALID_RESULT` on unknown event types (the adapter waits out its
  deadline), and purchase grant callbacks receive the exact platform
  payload shapes tests pin.
- **Session bootstrap, `ait:` hash prefixing, legacy-hash migration, and
  session invalidation when the anonymous identifier changes** — TrailBase
  owns identity lifecycle; only the raw SDK lookup is delegated.
- **Server callbacks** (product grant APIs, ad reward claims, notification
  consent sync) — connected by consumers through the existing callback and
  client options; nothing calls a TrailBase server implicitly.

## Consumer-visible changes (default paths only)

- RN anonymous-key lookups that fail validation now surface
  `ANONYMOUS_KEY_INVALID_RESPONSE` where the local flow distinguished
  `ANONYMOUS_KEY_ERROR` (`"ERROR"` sentinel) from invalid shapes — the
  shared adapter reports both as one invalid-response category. Injected
  `getAnonymousKey` functions keep the precise taxonomy. The error-code
  union is unchanged; `ANONYMOUS_KEY_ERROR` remains a valid value but is
  only produced by injected functions.
- RN purchases on the default path report grant failures as
  `IAP_PRODUCT_GRANT_FAILED` (the shared adapter flattens grant outcomes;
  the restore flow keeps distinguishing `IAP_PRODUCT_GRANT_TIMEOUT`).
  Purchases with an injected `IAP` module are unchanged.
- Web share results follow the shared adapter's contract: a resolved sheet
  call means "the SDK share call finished", never a reward authorization.

## Platform isolation

RN sources import only `@ait-kit/sdk/rn` (plus the runtime-neutral root for
`SdkError`); web sources import only `@ait-kit/sdk/web` and the root. Both
official SDKs remain **optional peers** of `@ait-kit/sdk`, so an RN consumer
never needs `@apps-in-toss/web-framework` and vice versa — enforced by the
consumer-fixture tests in both packages.
