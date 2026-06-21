# trailbase-guest-common

## 0.8.1 — 2026-06-21

### Patch changes

- [3aef7a7](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/3aef7a7871f6617e7a88856a9cec9eb2671e76f3) Avoid redundant TrailBase auth password-hash work when ensuring existing anonymous auth users during bootstrap. — Thanks @imjlk!

## 0.8.0 — 2026-06-21

### Minor changes

- [0f2f3e8](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/0f2f3e842479f6609cb3060733cce7e2f05f4020) Add a batch insert helper and app-owned SQL template for low-volume domain
  events, while documenting the boundary from high-volume analytics mirrors. — Thanks @imjlk!
- [8ae5b9f](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/8ae5b9fd010069567a71eb226667679cffb1e770) Optimize Smart Message outbox claiming to lock a ready batch with one update,
  preserve claim order, and document bulk dispatch grouping for functional message
  jobs. — Thanks @imjlk!
- [2bcd15e](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/2bcd15e1f49bb6c48bcc90cc793e3c8f1feb6c29) Add the recommended `analytics.events` table helper and SQL template, keep the
  legacy `analytics.analytics_events` path compatible, and optimize analytics
  batch insert helpers to reuse table validation and insert SQL per batch. — Thanks @imjlk!

## 0.7.0 — 2026-06-20

### Minor changes

- [cf5ded4](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/cf5ded486651742a2cb9a360218461f4dd65ec2c) Add shared AppsInToss functional ledger helpers and SQL templates for Smart Message outbox,
  promotion reward grants, and IAP order/grant persistence. — Thanks @imjlk!
- [159fc6d](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/159fc6d6a16d68c59199d6c846270c381975969c) Add an optional TrailBase analytics multi-db template, smoke check, runtime migration copy support
  for database-specific migration directories, and Rust helpers for inserting analytics event batches. — Thanks @imjlk!

## 0.6.0 — 2026-06-19

### Minor changes

- [8724a22](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/8724a22b6665e9dea5c01869283c1a2a8e3a279f) Add AppsInToss IAP bridge helpers, app-owned grant client utilities, and Rust
  order-status normalization helpers for TrailBase guest ledgers. — Thanks @imjlk!

## 0.5.0 — 2026-06-16

### Minor changes

- [2e9f71b](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/2e9f71b5cc3d5ef01cf989a5b24e5915adf4cff3) Require Toss Login AccessToken forwarding for the remove-by-user-key proxy adapter and treat
  top-level Toss error bodies as unlink failures. The adapter still keeps the internal proxy bearer
  token separate from Toss upstream authorization and does not echo raw user keys or access tokens.
  The Rust guest helper now requires the Toss Login AccessToken argument so consumers cannot call the
  unlink adapter without the upstream credential required by Toss. The proxy complete adapter also
  returns backend-only token metadata so proxy-mode consumers have a supported path for service-side
  unlink without bypassing the adapter. — Thanks @imjlk!

## 0.4.1 — 2026-06-16

### Patch changes

- [be480a6](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/be480a604107776c5a798ac78098aa95caf04fa9) Add a dedicated Toss Login remove-by-user-key proxy adapter and Rust helper. Consumer WASM guests no
  longer need to call the generic mTLS relay with the official Toss path, and the proxy normalizes
  unlink responses without echoing raw Toss user keys. — Thanks @imjlk!
- [942e06c](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/942e06c83ddd2018a6fa42b6192e4bb85b0ddab1) Add shared Toss Login unlink callback guards for TrailBase apps. Consumers can validate callback
  Basic Auth and allowed methods through the runtime production checks, use an entrypoint guard in
  production, and derive callback `toss_user_key_hmac` values through `toss_unlink` helpers without
  logging raw Toss user keys. — Thanks @imjlk!

## 0.4.0 — 2026-06-08

### Minor changes

- [8e5851c](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/8e5851c6be1db2f16778304fa0023eb289ab05ce) Generalize functional notification agreement storage around `template_code`,
  rename the dispatch gate fields to notification-specific names, and keep
  message-template consent keys normalized across current and legacy SQL schemas. — Thanks @imjlk!
- [e79fc6a](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/e79fc6a607e8f9f17a2ae7c1847027a656779bb1) Add generic TrailBase domain event helpers for app-owned event history tables,
  including safe SQL identifier validation, insert/list statement builders, and
  schema guidance that keeps server-side ledgers separate from AppsInToss
  Analytics. — Thanks @imjlk!

### Patch changes

- [2121078](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/212107855e79e2a575cdbf341ebf1775dac38eb3) Add a shared Toss Login sandbox stub decision helper and document that real
  AppsInToss sandbox `authorizationCode` values should be exchanged through the
  configured proxy or forward path instead of being treated as local stubs.
  Only explicit stub mode or simulator-only `dev-*` authorization codes should
  activate local fallback behavior. — Thanks @imjlk!
- [480b382](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/480b3829d7ba6c3094c860bb37970762ddcbb061) Add an internal AppsInToss smart-message bulk adapter for
  `send-bulk-message`, enforce the 2,500 recipient limit, and expose matching
  Rust proxy helpers for TrailBase jobs. Treat non-2xx upstream smart-message
  responses as failed dispatches instead of inferring success from missing Toss
  result fields. — Thanks @imjlk!

## 0.3.0 — 2026-06-05

### Minor changes

- [6971577](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/69715775ffe171cf83dbbe41a6f36c6b938154df) Add shared Toss identity store helpers, configurable unlink callback parsing/auth, DB-backed promotion campaign utilities with explicit env fallback control, and Apps in Toss login adapter/error normalization helpers. — Thanks @imjlk!
- [5b9339e](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/5b9339e79313ad6ed0572456f2c9a3750e26cfc7) Preserve the existing active TrailBase `_user` as canonical when upserting a Toss identity for a
  different anonymous `_user`, and return the canonical user from the shared helper. — Thanks @imjlk!
- [350be3e](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/350be3e65429dd3c07621f4e1206184f04cbf162) Add optional TrailBase anonymous auth hardening helpers for synthetic credential rotation,
  canonical anonymous-user aliases, and coarse bootstrap attempt limits, plus SQL templates and docs
  for profile auth state and bootstrap protection. — Thanks @imjlk!
- [ee8e837](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/ee8e837d0fd10e29b7398d4330a2b3bdffd852d5) Add shared promotion reward helpers for fixed and capped grant amounts, generic provider payloads,
  provider outcome normalization, amount-aware campaign availability checks, and adapter-based reward
  usage queries. — Thanks @imjlk!

### Patch changes

- [ce52936](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/ce52936566a16c340b749944cbaed3bacb8ec79c) Normalize AppsInToss smart-message responses around official `resultType`, delivery counts, detail,
  failure, and reach-failure fields, and add shared functional-message helpers plus SQL/docs templates
  for template registry, SDK notification agreement tracking, and reusable outbox provider summaries.
  The message `templateSetCode` and notification agreement SDK `templateCode` are stored separately so
  consumer apps can gate user-requested functional alerts before dispatching through the proxy. — Thanks @imjlk!
- [85059c3](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/85059c39784e0eb97a57ef31f09adc453752a8d2) Fix promotion reward failure timestamps, stabilize Apps in Toss upstream snapshot output, and
  document DB-backed promotion campaign activation requirements. — Thanks @imjlk!
- [fcbc9a7](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/fcbc9a7ce04b4dffc21f5707b292821547b0398e) Separate functional Smart Message `templateSetCode` from the notification agreement SDK
  `templateCode`, add a shared helper for persisting `requestNotificationAgreement` results, and
  gate user-requested functional alerts against the stored agreement code before dispatch. — Thanks @imjlk!

## 0.2.0 — 2026-05-18

### Minor changes

- [997c979](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/997c9799fcb496f27fa65b52208eda2fe8c31504) Add shared Apps in Toss direct login helpers for generating access tokens and reading user keys. — Thanks @imjlk!

## 0.1.4 — 2026-05-16

### Patch changes

- Versioned with the shared Toss identity helper crate.

## 0.1.3 — 2026-05-11

### Patch changes

- Add shared AppsInToss proxy adapter helpers for promotion rewards and smart messages.

## 0.1.2 — 2026-05-11

### Patch changes

- Add shared AppsInToss proxy helpers for Toss login, IAP order status, and proxy failure messages.

## 0.1.1 — 2026-05-11

### Patch changes

- Add shared TrailBase guest helpers for API responses, settings, database access, and session handling.
