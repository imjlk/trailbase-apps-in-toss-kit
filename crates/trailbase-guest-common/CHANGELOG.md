# trailbase-guest-common

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
  The functional notification `templateCode` is stored as a generic `template_code` so consumer apps
  can gate user-requested functional alerts before dispatching through the proxy. — Thanks @imjlk!
- [85059c3](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/85059c39784e0eb97a57ef31f09adc453752a8d2) Fix promotion reward failure timestamps, stabilize Apps in Toss upstream snapshot output, and
  document DB-backed promotion campaign activation requirements. — Thanks @imjlk!
- [fcbc9a7](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/fcbc9a7ce04b4dffc21f5707b292821547b0398e) Add a shared helper for persisting
  `requestNotificationAgreement` results and gate user-requested functional alerts against the
  stored functional notification template code before dispatch. — Thanks @imjlk!

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
