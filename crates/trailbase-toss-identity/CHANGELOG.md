# trailbase-toss-identity

## 0.8.0 — 2026-06-21

### Patch changes

- Updated dependencies: trailbase-guest-common (Cargo)@0.8.0

## 0.7.0 — 2026-06-20

### Patch changes

- Updated dependencies: trailbase-guest-common (Cargo)@0.7.0

## 0.6.0 — 2026-06-19

### Patch changes

- Updated dependencies: trailbase-guest-common (Cargo)@0.6.0

## 0.5.0 — 2026-06-16

### Patch changes

- Updated dependencies: trailbase-guest-common (Cargo)@0.5.0

## 0.4.1 — 2026-06-16

### Patch changes

- Updated dependencies: trailbase-guest-common (Cargo)@0.4.1

## 0.4.0 — 2026-06-08

### Patch changes

- Updated dependencies: trailbase-guest-common (Cargo)@0.4.0

## 0.3.0 — 2026-06-05

### Minor changes

- [6971577](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/69715775ffe171cf83dbbe41a6f36c6b938154df) Add shared Toss identity store helpers, configurable unlink callback parsing/auth, DB-backed promotion campaign utilities with explicit env fallback control, and Apps in Toss login adapter/error normalization helpers. — Thanks @imjlk!

### Patch changes

- [fcbc9a7](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/fcbc9a7ce04b4dffc21f5707b292821547b0398e) Separate functional Smart Message `templateSetCode` from the notification agreement SDK
  `templateCode`, add a shared helper for persisting `requestNotificationAgreement` results, and
  gate user-requested functional alerts against the stored agreement code before dispatch. — Thanks @imjlk!
- Updated dependencies: trailbase-guest-common (Cargo)@0.3.0

## 0.2.0 — 2026-05-18

### Patch changes

- Updated dependencies: trailbase-guest-common (Cargo)@0.2.0

## 0.1.4 — 2026-05-16

### Patch changes

- Add shared Toss Login unlink callback helpers for Basic Auth validation, `userKey` validation,
  callback payload deserialization, and unlink referrer normalization.
- Updated dependencies: trailbase-guest-common (Cargo)@0.1.4

## 0.1.3 — 2026-05-11

### Patch changes

- Updated dependencies: trailbase-guest-common (Cargo)@0.1.3

## 0.1.2 — 2026-05-11

### Patch changes

- Add shared AppsInToss proxy helpers for Toss login, IAP order status, and proxy failure messages.
- Updated dependencies: trailbase-guest-common (Cargo)@0.1.2

## 0.1.1 — 2026-05-11

### Patch changes

- Add shared TrailBase guest helpers for API responses, settings, database access, and session handling.
- Updated dependencies: trailbase-guest-common (Cargo)@0.1.1
