# TrailBase Ops Reference

## Migration Guardrails

- Treat production and production-like data as durable by default.
- Do not edit baseline SQL for normal feature work after production deploys have started.
- Add a new migration under the repo's TrailBase migration directory for schema changes.
- Keep migrations additive unless the user has explicitly approved a destructive migration/reset.
- Safe additive changes include new tables, indexes, views, nullable columns, backfills, and compatible
  defaulted columns.
- If `config.textproto` or Record API exposure changes, update it in the same change as the migration.

## Baseline Reset And Fresh Start

- Baseline rewrites are allowed only for explicit baseline reset, local-only cleanup, or intentionally
  disposable early deployments.
- `TRAILBASE_FRESH_START_TOKEN` is destructive when paired with the repo's confirmation variable.
- Reusing the same fresh-start token should not delete data again when the repo tracks an applied
  marker, but changing the token requests another reset.
- Keep fresh-start env values empty in normal production runs.

## Record API And Public Surface

- Public Record API should be read/subscription only unless a repo explicitly documents otherwise.
- App and admin writes should go through WASM endpoints/jobs where authorization and invariants live.
- Never expose raw Toss user keys, HMACs, sealed values, secrets, or admin-only projections through
  Record API or user-visible responses.
- Run the repo's ACL check when available after changing `config.textproto`.

## TrailBase Auth Principal Pattern

- New AppsInToss integrations should map the anonymous AppsInToss identity into TrailBase `_user`
  during bootstrap. Return TrailBase auth, refresh, and CSRF tokens from the official auth flow;
  never recreate TrailBase JWT signing or insert `_session` rows manually.
- Synthetic `_user.email` values are service-managed implementation details. Keep Toss email or later
  OAuth/OIDC email claims in provider-specific profile/identity metadata until they are verified and
  intentionally promoted.
- `profiles` is an app-owned pattern, not a kit runtime requirement. When an app uses it, store public
  profile fields there and keep private fields such as `anonymous_hash_hmac` out of public views.
- Track application auth state separately from TrailBase email verification, for example `anonymous`,
  `toss_linked`, `email_linked`, or `disabled`. Custom WASM endpoints must reject disabled app users
  even if TrailBase still accepts an old auth token until the client bootstraps again.
- Do not add app-owned `users` auth tables. If a consumer already has one, migrate product fields and
  foreign keys to `_user`-keyed profiles or domain tables, then remove the old table once the
  consumer's data retention decision allows it.
- When a provider identity collision makes another `_user` canonical, write an alias such as
  `anonymous_user_links` before returning tokens for the canonical user. Bootstrap handlers should
  check aliases before creating or resurrecting app rows.
- Store provider identities with a deterministic lookup key and, only when needed, a sealed reversible
  value. For Toss this is `toss_user_key_hmac` plus `toss_user_key_sealed`; future OAuth/OIDC
  integrations should use a provider plus subject mapping to the canonical `_user`.
- For anonymous `_user` bootstrap, prefer
  `trailbase_guest_common::trailbase_auth::ensure_verified_auth_user_tx` so existing synthetic email
  rows are loaded or verified without recomputing password hashes. New rows still get a
  service-managed password hash on insert, and the missing-row path keeps first-bootstrap races
  idempotent with an atomic upsert.
- Support service-managed password rotation with a current and previous password secret, then rehash
  the `_user` password to the current secret after a successful previous-secret login. Keep that
  rotation in `login_anonymous_auth_user_with_password_rotation`; the ensure helper only creates or
  loads the verified auth user. The compatibility `upsert_verified_auth_user_tx` API still refreshes
  the password hash for callers that have not moved rotation to the login helper.
- TrailBase 0.31.2 removed `_user.verified` in favor of `unverified_email`. Use the
  kit auth helpers, which detect both schemas, instead of app-local inserts. Rebuild
  components with guest runtime 0.6.1 when moving to the verified 0.33.14 server.
  New component binaries are not compatible with pre-0.32 hosts.
- Add coarse anonymous bootstrap rate limits before `_user` creation or login attempts.
- For verified anonymous bootstrap, use `anonymous_identity::verify_anonymous_hash` before
  creating/authenticating `_user`; preserve the existing HMAC of `ait:<hash>` and aliases.
  Apply private `anonymous_identities.sql` and use the verified-key seal/store helpers.
  Anonymous dispatch uses `message_recipients` and the same notification/marketing gate.
  Apply the additive recipient migration once, stop legacy workers, and keep promotion
  recovery bound to the originally stored anonymous recipient and transaction key.

## React Native Client Bootstrap And Helpers

When initializing or refactoring a TrailBase-backed AppsInToss React Native app, do not start by
copying app-local wrappers for SDK identity, storage, login, or session state. First inspect the
current kit exports and docs:

- `packages/trailbase-client/src/index.ts`
- `packages/trailbase-client/src/apps-in-toss.ts`
- `packages/trailbase-client/src/storage.ts`
- `packages/ait-rn/src/index.ts`
- `docs/en/client-adapters.md` and `docs/ko/client-adapters.md`

Use helpers that exist in the checked-out kit before writing app-specific code. Current helper
surfaces include:

- `createAppsInTossSessionLifecycle` for account transitions, scoped requests/cache keys,
  subscription cleanup, and server entitlement/pending-work revalidation on foreground.
  Use one manager per storage namespace; catch `StaleAppSessionOperationError` for
  superseded auth operations. `disconnect()` is local cleanup, not server unlink.
  See `docs/en/session-lifecycle.md` and its Korean counterpart.
- `createAppsInTossSessionManager` for app session restore, anonymous bootstrap, and Toss login
  upgrade flows while preserving TrailBase `_user` as the authenticated principal.
- `createAppsInTossKeyValueStorage`, `createMemoryKeyValueStorage`, and
  `createWebLocalStorageKeyValueStorage` for Apps in Toss `Storage` persistence with explicit
  dev/test fallbacks.
- `requestAppsInTossLogin` and `normalizeAppsInTossLoginResult` for Toss Login result normalization
  and user-facing SDK error messages.
- `@trailbase-apps-in-toss-kit/ait-rn/notifications` for functional Smart Message agreement result
  normalization and functional message backend clients.
- `@trailbase-apps-in-toss-kit/ait-rn` helpers such as `createAppsInTossIdentityStorage`,
  `createAppsInTossSessionStorage`, `createAppsInTossLoginBridge`,
  `ensureAppsInTossHapticFallback`, `createPersistentJsonAtom`,
  `resolveAppsInTossAnonymousHash`, and `isAppsInTossAnonymousHash` for RN non-game anonymous
  identity seeding, session storage composition, Toss Login bridge injection, TDS haptic runtime
  compatibility, and tiny app-local JSON state.

Future helper categories should follow the same rule: once the kit exports a reusable helper, use it
for new app bootstrap or migration work instead of preserving divergent app-local copies. If a helper
is planned but not exported yet, do not import a guessed name. Keep any temporary app-local adapter
small, document the intended migration, and prefer adding the helper to the kit in a separate PR.

When adding a new reusable helper to the kit, update these in the same PR:

- package exports and tests
- `docs/en/client-adapters.md` and `docs/ko/client-adapters.md`
- this `trailbase-ops` skill/reference when the helper affects app bootstrap, auth/session behavior,
  storage, login, notification agreement, haptics/runtime compatibility, or another repeated
  AppsInToss integration concern
- a Sampo changeset when the helper changes package behavior or public API

Do not let this skill replace official Apps in Toss SDK/API documentation. Use official docs tooling
for SDK signatures and availability, then apply the kit helper preference only after confirming the
helper exists in the checked-out package.

## WASM And Runtime Settings

- Run `cargo check --manifest-path apps/trailbase/wasm/Cargo.toml --workspace --target wasm32-wasip2`
  or the repo script equivalent after WASM changes.
- Keep API response shape and Record API wire shape stable unless the user explicitly asks for a
  breaking change.
- Use repo-local settings helpers and production validators instead of ad hoc env parsing.
- For high-volume detailed analytics, prefer the optional `analytics.events` database template over
  mixing analytics rows into product tables in `main`. Consumer apps should add `databases: [{ name:
  "analytics" }]`, place migrations under `migrations/analytics/`, and write through app-owned
  endpoints using `trailbase_guest_common::analytics_events::ANALYTICS_EVENTS_TABLE` when helpful.
  Existing `analytics.analytics_events` deployments can keep using `DEFAULT_ANALYTICS_EVENTS_TABLE`
  for compatibility. Custom database migrations are applied when a connection references the
  configured database, so make sure the endpoint path attaches or otherwise opens the `analytics`
  database before using qualified inserts. The write path should use one transaction per batch and
  should not run DDL per request; use migrations or a `PRAGMA analytics.user_version` guarded fallback
  initializer. Do not put functional ledgers such as notification agreement history, message outbox,
  promotion grants, IAP grants, or rewards in the analytics sink.
- For AppsInToss functional ledgers, prefer kit templates and Rust helpers before copying
  consumer-local SQL snippets between apps:
  - `message_templates.sql`, `notification_template_agreements.sql`, and `message_outbox.core.sql`
    with `trailbase_guest_common::apps_in_toss_messages` for Smart Message agreement, enqueue,
    claim/lock, skip, fail, and completion flows.
  - `promotion_campaigns.sql` plus optional `promotion_reward_ledger.sql` with
    `trailbase_guest_common::promotion_campaigns` and `promotion_rewards` for campaign config,
    provider grant ledgers, provider outcome persistence, and budget usage checks.
  - `iap_orders.sql` with `trailbase_guest_common::iap_orders` for order-status persistence and
    idempotent local grant marking.
  - `operation_policies.sql` with `trailbase_guest_common::operation_policy` for per-feature
    entry/dispatch/settlement controls and read-only status. Set `KIT_OPERATION_POLICIES_ENABLED=1`
    to enable the listed built-in guards, and wire consumer-owned paths explicitly. For WASM,
    put these string settings in a private `/settings.json` mounted through `--runtime-root-fs`;
    host environment variables alone are not inherited. Keep `KIT_OPERATIONS_HOLD=1` outside
    restored backups, verify `operation_policy_integration()`, restart instances after changing
    settings, and reconcile an independent durable witness before operator resume. See the
    English/Korean `operation-policy.md` docs and runtime `restore-checkpoint` check.
  - `app_reward_attempts.sql` with `trailbase_guest_common::app_rewards` for server-issued
    app-owned AD/SHARE attempts and atomic once-only local credits. Require explicit server
    offer/eligibility/transactional quota policies; client SDK events and attempt IDs are not
    proof of viewing or sharing. The grant row is the credit, not a trigger for another payment.
    Keep receipt lookup during pauses. See `docs/en/app-rewards.md` and `docs/ko/app-rewards.md`.
  For recoverable message workers, apply `message_outbox_attempts.sql` and use
  `message_outbox_recovery` leases. Commit the dispatch permit before sending; expired
  in-flight sends are UNKNOWN and must not be automatically resent. Stop legacy workers
  before migration. IAP local grants leave `completed_at` empty until explicit Toss
  completion confirmation through `mark_iap_order_completed_tx`. Promotion recovery
  uses `apps_in_toss_proxy::promotion_reward_status` with a persisted transaction key.
  Subscription flows use `iap_subscriptions.sql` with `iap_subscriptions` parsing,
  inbox, ordering, and per-order entitlement helpers. Authenticate webhooks at the
  consumer ingress; never use client SDK status to authorize server benefits.
  For private support inquiries, use the read-only `trailbase-runtime/ledger-doctor`
  and `ledger_diagnostics::ledger_diagnostic_id` fingerprints. Inspect a consistent
  SQLite backup with an explicit timestamp unit; reports are not permission to grant,
  resend, or change state. Re-read live state and use existing owner/attempt guards
  for actual recovery. See `docs/en/ledger-doctor.md` and its Korean counterpart.
  Keep these tables in the app/product database by default, not the `analytics` database. Eligibility,
  product grant rules, inventory/balance updates, cooldowns, and public projections stay app-owned.
  After changing the shared functional ledger SQL templates, run
  `bun run trailbase:functional-ledgers:smoke` from the kit checkout to verify the templates apply
  together, keep their expected indexes, and do not create analytics database tables.
- For low-volume app-owned domain history and operations events, use
  `templates/trailbase/sql/domain_events.sql` and `trailbase_guest_common::domain_events`. Keep this
  separate from the high-volume `analytics.events` mirror, and use the batch insert helper when one
  WASM handler records several domain events in the same transaction.

## Deployment And mTLS Proxy

- TrailBase is a SQLite single-writer service. Prefer build/pull followed by `up -d --no-deps
  --force-recreate trailbase`; avoid rolling updates and avoid `docker compose down` in production.
- The mTLS proxy is an internal outbound client proxy, not a public callback server.
- The proxy image can be public, but the running proxy service should stay private on the internal
  Compose/platform network.
- Mount Toss certificate files only into the proxy container, typically at `/run/mtls`.
- Application services should see only the internal proxy URL and bearer token.
- Production image references should use exact SemVer or minor tags, not `edge` or `latest`, unless
  moving tags are intentionally being tested.

- Use the Release Doctor `proxy-capabilities` check before enabling a newly required adapter.
  Its internal health contract reports package version and implemented capabilities; it does
  not verify upstream readiness or eligibility. Older proxies require an upgrade before
  this check becomes mandatory. Supply tokens through env variable names, never config text.

## Apps In Toss Docs Tooling

This skill should not replace official Apps in Toss SDK/API documentation lookup.
When a task is primarily about Apps in Toss, Toss Login, IAP, Promotion, Smart
Message, notification agreement, `requestNotificationAgreement`, Granite,
Bedrock, TDS, or app review policy, first discover available Apps in Toss MCP,
CLI, docs-search, or project-validator tooling. Search Apps in Toss docs with
concise Korean keywords, keeping proper nouns and API names as-is.

## Repo Discovery Checklist

Before changing this kit repository, inspect the relevant files:

- `AGENTS.md`
- `crates/trailbase-guest-common/`
- `crates/trailbase-toss-identity/`
- `services/toss-mtls-client-proxy/`
- `packages/trailbase-client/`
- `packages/trailbase-runtime/`
- `templates/trailbase/`
- `docs/en/` and `docs/ko/`
- `data/upstream/`

Before changing a consumer TrailBase app, inspect:

- `AGENTS.md`
- `apps/trailbase/README.md`
- `apps/trailbase/RUNBOOK.md`
- `apps/trailbase/scripts/production-release-check.sh`
- `apps/trailbase/traildepot-template/config.textproto`
- `apps/trailbase/traildepot-template/migrations/main/`
- optional `apps/trailbase/traildepot-template/migrations/analytics/`
- Root `package.json` TrailBase helpers, especially container-side CLI aliases such as `trail`

## WebView SDK 3 adapters

For WebView consumers, use `@trailbase-apps-in-toss-kit/ait-web` with the consumer's
`@apps-in-toss/web-framework` 3.x dependency; keep RN adapters on their separate
framework line. The factory covers SDK Storage, login/anonymous identity,
notification agreement, one-time/subscription IAP and sharing. It loads current
SDK namespaces lazily, checks availability, requires a backend grant callback,
and never invents identities or migrates localStorage implicitly. Keep server
verification and account lifecycle controls. Read the official SDK docs first,
then `docs/en/web-adapters.md` / `docs/ko/web-adapters.md` for kit integration.

## Encryption-key rotation

Use `trailbase_toss_identity::TossIdentityKeyRing` for opt-in v1/v2 readers and new
v2 writers, and `reseal::reseal_identity_batch_tx` for bounded CAS maintenance of
private Toss/anonymous ciphertext. Deploy all readers before writers, keep old
keys for retained backups, and save the per-table/rotation cursor in the same
transaction. Never log the cursor (anonymous cursors are HMACs), keys, plaintext
or ciphertext. HMAC lookup-key rotation is a separate account-mapping migration.
See `docs/en/identity-key-rotation.md` and its matching Korean document.
