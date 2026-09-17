# trailbase-toss-identity

## 0.12.0 — 2026-09-17

### Patch changes

- Updated dependencies: trailbase-guest-common (Cargo)@0.12.0

## 0.11.0 — 2026-09-16

### Patch changes

- Updated dependencies: trailbase-guest-common (Cargo)@0.11.0

## 0.10.0 — 2026-09-12

### Minor changes

- [b16dac5](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/b16dac5ea0d1069034972cc8bd99b2e157b4deb6) Add an opt-in identity encryption key ring with an authenticated v2 key ID,
  explicit legacy-v1 reader and bounded restartable reseal batches for the private
  Toss/anonymous identity templates. Existing single-key v1 APIs remain unchanged.
  Deploy compatible readers before new writers; keep older keys for retained data
  and backups. Rebuild WASM and save batch cursors with ciphertext updates in the
  same private transaction. Stop old writers and repeat a full sweep before retiring
  keys. No identity-column migration is required; consumers own optional job state.
  
  HMAC lookup keys, account ownership and revocation state are unchanged. Do not
  log private cursors, ciphertext or keys. A rollback must retain v2-capable readers. — Thanks @imjlk!

### Patch changes

- Updated dependencies: trailbase-guest-common (Cargo)@0.10.0

## 0.9.0 — 2026-09-12

### Minor changes

- [415decc](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/415decc0e44105d490767017e13137c20efd5a6d) Add RN subscription purchase and status-query bridges with per-API support checks,
  subscription identifiers, renewal cycles and offers, while retaining one-time
  purchase/restore behavior and older injected SDK support for existing methods.
  
  Add a private subscription webhook inbox and per-order entitlement projection.
  Apply iap_subscriptions.sql after the order ledger as a new consumer migration.
  Authenticate webhook ingress in the consumer, map renewal orders authoritatively,
  and configure provider-local timestamp conversion explicitly. Duplicate/older
  events cannot overwrite current state; equal-time conflicts require reconciliation.
  Client SDK status never independently authorizes server benefits. Subscription
  sandbox testing is unavailable, so validate the feature in the real Toss app
  before consumer rollout. The proxy remains internal and outbound-only.
  
  Prevent failed or fallback-only lookups from reserving new order IDs, and require
  verified order state when applying or reading subscription entitlements. Handle
  UNVERIFIED_IAP_ORDER for lookups that cannot establish a new owner mapping. Normalize
  offer fields consistently and reject unsupported explicit registration versions. — Thanks @imjlk!
- [cfb560e](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/cfb560e4bb791e8f1e4980ae7a5522d82a54b56f) Verify Apps in Toss anonymous keys through the private proxy before bootstrap,
  retaining the existing HMAC of ait:<hash> and canonical TrailBase user flow.
  Add verified-key sealing, private identity storage, explicit message recipients,
  and anonymous promotion grants/status lookup with request-local header adaptation.
  
  Apply anonymous_identities.sql, the one-time message_outbox_recipients migration,
  and optional promotion_reward_recipients.sql as new consumer migrations. Stop
  legacy dispatch workers before enabling anonymous rows, preserve notification
  agreement checks for both recipient types, and deploy the next proxy image before
  using verification or anonymous promotion. Existing login rows remain unchanged.
  Consumer real-app/sandbox validation is still required before production rollout.
  
  Normalize anonymous enqueue identifiers before persistence so whitespace cannot
  bypass idempotency or break exact notification-template agreement lookup.
  
  Strip raw recipient fields from both login and anonymous outbox payloads before
  persistence, including nested context. Scrub any existing raw recipient fields
  through a consumer-owned data migration; idempotent retries preserve historical rows. — Thanks @imjlk!
- [ae4382f](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/ae4382f25c4d7ea15d8dccef5e0da6cf847682f0) Upgrade trailbase-wasm to 0.6.1 and verify the 0.33.14 server with an isolated
  component/auth/Record API/SSE integration smoke. Rebuild all consumer components
  and coordinate the server/guest rollout; new binaries do not support pre-0.32
  hosts. Update the first-party auth-ui component separately.
  
  Fix anonymous bootstrap and password rotation for the post-0.31.2 _user schema,
  which replaced verified with unverified_email. Existing flag-based schemas remain
  supported by the SQL helpers; verified principals and pending email changes are
  preserved. Official auth endpoints still issue tokens. The last verified server
  moves to 0.33.14; the manual kit minimum stays TBD. Consumer production/device and
  full migration checks remain required before rollout.
  
  Trigger runtime smoke checks on client/parser dependency changes and verify the
  read-only Record API ACL with valid auth, CSRF and a complete record payload. — Thanks @imjlk!
- [6fb1b82](https://github.com/imjlk/trailbase-apps-in-toss-kit/commit/6fb1b82e781c75e95af6cd6968f26c73f61cb609) Recover TanStack collections after SSE disconnects using complete paginated
  snapshots, deletion reconciliation, and queued events with react-db 0.3.8. Set
  snapshotMode to merge for partial lists; the default now treats limit as page size.
  
  Add optional message dispatch leases with attempt fencing and quarantine uncertain
  in-flight sends instead of resending them. Apply message_outbox_attempts.sql as a
  new consumer migration and stop legacy workers before adopting leased APIs. Rust
  message responses now include channel failure details and content identifiers.
  
  Record local IAP grant and Toss completion separately. Existing completion history
  is preserved; newly granted rows need explicit confirmation. Query promotion
  results with the persisted transaction key through the new status endpoint; missing
  keys require reconciliation rather than a new grant. Deploy the next proxy image
  before using that endpoint. No minimum TrailBase server change is required.
  
  Make XHR SSE connection setup abortable during cleanup and bound header resolution
  and response-header waits with a configurable 15-second connection deadline. — Thanks @imjlk!

### Patch changes

- Updated dependencies: trailbase-guest-common (Cargo)@0.9.0

## 0.8.1 — 2026-06-21

### Patch changes

- Updated dependencies: trailbase-guest-common (Cargo)@0.8.1

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
