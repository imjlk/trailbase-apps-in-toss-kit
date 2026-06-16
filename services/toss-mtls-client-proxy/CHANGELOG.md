# @trailbase-apps-in-toss-kit/toss-mtls-client-proxy

## 0.1.9 — 2026-06-16

### Patch changes

- [2e9f71b](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/2e9f71b5cc3d5ef01cf989a5b24e5915adf4cff3) Require Toss Login AccessToken forwarding for the remove-by-user-key proxy adapter and treat
  top-level Toss error bodies as unlink failures. The adapter still keeps the internal proxy bearer
  token separate from Toss upstream authorization and does not echo raw user keys or access tokens.
  The Rust guest helper now requires the Toss Login AccessToken argument so consumers cannot call the
  unlink adapter without the upstream credential required by Toss. The proxy complete adapter also
  returns backend-only token metadata so proxy-mode consumers have a supported path for service-side
  unlink without bypassing the adapter. — Thanks @imjlk!

## 0.1.8 — 2026-06-16

### Patch changes

- [4c7fa37](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/4c7fa37c6cee245e02cf51f5d5b63163ae09f175) Add `--health-only`, `--full`, and expected-mode checks to the reusable Toss mTLS proxy smoke
  script. The default mode now verifies forward proxy health for production pre-QA, while full adapter
  payload smoke tests stay available only for local stub environments via `--full`. — Thanks @imjlk!

## 0.1.7 — 2026-06-16

### Patch changes

- [be480a6](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/be480a604107776c5a798ac78098aa95caf04fa9) Add a dedicated Toss Login remove-by-user-key proxy adapter and Rust helper. Consumer WASM guests no
  longer need to call the generic mTLS relay with the official Toss path, and the proxy normalizes
  unlink responses without echoing raw Toss user keys. — Thanks @imjlk!

## 0.1.6 — 2026-06-08

### Patch changes

- [480b382](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/480b3829d7ba6c3094c860bb37970762ddcbb061) Add an internal AppsInToss smart-message bulk adapter for
  `send-bulk-message`, enforce the 2,500 recipient limit, and expose matching
  Rust proxy helpers for TrailBase jobs. Treat non-2xx upstream smart-message
  responses as failed dispatches instead of inferring success from missing Toss
  result fields. — Thanks @imjlk!

## 0.1.5 — 2026-06-05

### Patch changes

- [ce52936](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/ce52936566a16c340b749944cbaed3bacb8ec79c) Normalize AppsInToss smart-message responses around official `resultType`, delivery counts, detail,
  failure, and reach-failure fields, and add shared functional-message helpers plus SQL/docs templates
  for template registry, SDK notification agreement tracking, and reusable outbox provider summaries.
  The message `templateSetCode` and notification agreement SDK `templateCode` are stored separately so
  consumer apps can gate user-requested functional alerts before dispatching through the proxy. — Thanks @imjlk!
- [a0a1d3f](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/a0a1d3f2107c84908598dbe1a139d5b8e344044d) Update the reusable Toss mTLS proxy smoke template to exercise Toss login,
  promotion reward grants, and smart-message dispatch, matching the current
  AppsInToss operational paths used by consumer apps. — Thanks @imjlk!

## 0.1.4 — 2026-05-22

### Patch changes

- Allow AppsInToss promotion reward requests to provide per-request campaign
  codes and amounts, and surface provider error codes so consumers can pause or
  exhaust DB-backed campaigns safely.

## 0.1.3 — 2026-05-18

### Patch changes

- [91cd21b](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/91cd21b40d12fc12c0b65776eb9494079e011c72) Retry transient Apps in Toss IAP order-status responses and preserve the requested SKU when Toss omits it. — Thanks @imjlk!

## 0.1.2 — 2026-05-16

### Patch changes

- Auto-detect a single Toss Console mTLS certificate pair named `*_public.crt` and `*_private.key`
  from the mounted certificate directory before falling back to explicit path env vars.

## 0.1.1 — 2026-05-11

### Patch changes

- Harden the mTLS proxy runtime validation, request limits, upstream timeout handling, and operator
  documentation.
