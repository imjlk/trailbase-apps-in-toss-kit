# Apps in Toss Upstream Tracking

This repository is a reusable TrailBase integration kit for Apps in Toss
services. It does not vendor the Apps in Toss React Native SDK, Granite runtime,
or TDS packages. Consumer apps own those dependencies and should update them
only after app-level smoke tests.

## Official Upstream Sources

- Release notes: https://developers-apps-in-toss.toss.im/release-note/release-note.md
- LLM index: https://developers-apps-in-toss.toss.im/llms.txt
- React Native tutorial: https://developers-apps-in-toss.toss.im/ai-vibe-coding/tutorials/react-native.md
- React Native reference: https://developers-apps-in-toss.toss.im/documentation/react-native.md
- WebView Client SDK: https://developers-apps-in-toss.toss.im/documentation/sdk.md
- WebView SDK 3.x migration: https://developers-apps-in-toss.toss.im/development/sdk-3.x.md
- API overview: https://developers-apps-in-toss.toss.im/documentation/overview.md
- Integration getting started: https://developers-apps-in-toss.toss.im/documentation/integration/getting-started.md
- Server API integration: https://developers-apps-in-toss.toss.im/documentation/integration/server-api.md
- API authentication and mTLS: https://developers-apps-in-toss.toss.im/documentation/api/auth.md
- Toss Login API: https://developers-apps-in-toss.toss.im/documentation/api/toss-login.md
- In-app purchase API: https://developers-apps-in-toss.toss.im/documentation/api/iap.md
- Promotion API: https://developers-apps-in-toss.toss.im/documentation/api/promotion.md
- Push and Smart Message API: https://developers-apps-in-toss.toss.im/documentation/api/push.md
- Smart Message overview and notification agreement policy: https://developers-apps-in-toss.toss.im/documentation/common/growth/smart-message.md
- Notification agreement SDK: https://developers-apps-in-toss.toss.im/documentation/sdk/domains-api/notification/notification.requestagreement.md
- Non-game user identity key: https://developers-apps-in-toss.toss.im/documentation/sdk/domains-api/user/user.getanonymouskey.md
- TDS React Native docs: https://tossmini-docs.toss.im/tds-react-native/

## Compatibility Policy

- Consumer SDK, Granite, and TDS package versions are app-owned.
- Do not add `@apps-in-toss/framework`, `@granite-js/react-native`, or TDS packages
  to this kit's runtime dependencies just to track upstream.
- The repository root may pin `@apps-in-toss/framework` as a dev dependency for
  lockfile/reference validation, but published/private kit packages must keep
  Apps in Toss SDK packages as peer or injected dependencies.
- React Native non-game mini-apps should seed anonymous TrailBase principals from
  the `{ type: "HASH", hash }` result returned by Apps in Toss `getAnonymousKey()`.
- Random local hashes and `createAnonymousHash()` results are local/dev/test
  fallbacks, not production identity seeds.
- Non-game mini-apps must use TDS. TDS is optional for games.
- New React Native mini-apps should use Granite terminology and framework 1.0 or
  newer.
- Apps in Toss SDK 3.x currently applies to WebView projects through
  `@apps-in-toss/web-framework@rc`; it is not an upgrade target for this
  repository's React Native `@apps-in-toss/framework` reference.
- Framework 1.0 and newer should use `@toss/tds-react-native`; legacy framework
  versions used `@toss-design-system/react-native`.
- mTLS API changes affect the proxy and server-side integration surface; review
  Login, IAP, promotion, Smart Message, and notification agreement behavior
  together.
- Functional Smart Message flows that represent a user-requested future alert
  must use the Apps in Toss notification agreement SDK before server dispatch.
  Persist the SDK `templateCode` as the app's functional notification
  `template_code`. The default kit SQL manages the message `templateSetCode`
  and SDK `templateCode` as the same functional notification code.
- `requestNotificationAgreement` is documented for React Native and WebView SDK
  v2.5.0 or newer. Do not enable user-requested functional alert flows on older
  consumer SDK versions.

## Renovate-Tracked Reference Versions

<!-- renovate: datasource=npm depName=@apps-in-toss/framework versioning=npm -->
- `apps-in-toss-framework`: `2.10.8`

<!-- renovate: datasource=npm depName=@toss/tds-react-native versioning=npm -->
- `tds-react-native`: `2.0.4`

<!-- renovate: datasource=npm depName=create-granite-app versioning=npm -->
- `create-granite-app`: `1.0.38`

<!-- renovate: datasource=npm depName=@granite-js/react-native versioning=npm -->
- `granite-js-react-native`: `1.0.38`

- `@toss-design-system/react-native`: legacy package name for pre-1.0 framework
  projects. No public npm `latest` metadata was available during the initial
  tracking snapshot, so new apps should not use it as the active reference.

If you edit these Renovate marker blocks or `renovate.json`, validate the
configuration with `bun run renovate:validate`. After an upstream snapshot PR
detects an SDK package change, review the release notes and update the root
reference dependency, lockfile, and these markers in the same follow-up PR. The
snapshot script is intentionally detection-only; use
`bun run apps-in-toss:tracking:check` to verify that the snapshot, root
`package.json`, and English/Korean tracking markers agree.

## Latest Reviewed SDK Delta

The repository reference has been reviewed through `@apps-in-toss/framework`
`2.10.8`.

- `2.8.0`: Added non-game navigation bar theme settings.
- `2.9.0`: Added the `ait deploy --timeout` option for app bundle deployment.
- `2.9.2`: Game apps now show an exit confirmation modal when the Toss app
  navigation bar X button is pressed. Non-game apps still exit directly.
- `2.10.1`: Refreshes the tracked Apps in Toss reference package family for
  metadata validation. Consumer apps should review upstream SDK notes and run
  app-level smoke tests before adopting it.
- `2.10.4`: Refreshes the tracked Apps in Toss framework reference and Granite
  package family for metadata validation. No shared kit API change is required.
- `2.10.5`: Fixes bottom-screen touch handling when the navigation bar uses
  transparent mode.
- `2.10.6`: Fixes intermittent WebView flickering around bottom sheets.
- `2.10.7`: Fixes an intermittent iOS white screen for heavy Toss users opening
  WebView mini-apps.
- `2.10.8`: Aligns React Native mini-app banner image presentation with the
  WebView banner specification.

The July 2026 API update also allows promotion, Smart Message, and Toss Pay
server APIs to identify users with an anonymous hash in addition to Toss Login
`userKey`. Existing proxy adapters continue to use `userKey`; adding anonymous
hash input is a separate API-surface change and must preserve the rule that raw
identifiers are not logged or returned.

No shared kit API change is required for these SDK deltas. Consumer apps should
still run app-level smoke tests before raising their own supported Apps in Toss
SDK/runtime policy.

## Doc Watch Outputs

The `Apps in Toss doc watch` workflow writes upstream snapshots to:

- `data/upstream/apps-in-toss/docs-snapshot.md`
- `data/upstream/apps-in-toss/docs-snapshot.json`

The snapshot stores document hashes and npm reference package metadata. It does
not copy full upstream documents into this repository. The snapshot command
rejects empty responses, GitBook `Page Not Found` documents returned with HTTP
200, and responses that do not contain the expected document marker.

The workflow currently reuses `TRAILBASE_RELEASE_WATCH_TOKEN` as the upstream
watch PR token. That token must be able to push branches and open pull requests
for this repository so generated PRs trigger downstream `pull_request` checks.

## Review Checklist When Apps in Toss Changes

- Check release notes for React Native SDK 2.x and Granite changes.
- Review WebView SDK 3.x migration separately; do not apply its config or
  package changes to React Native consumers.
- Check whether React Native, React, or Toss app minimum versions changed.
- Check mTLS API integration process changes before modifying proxy behavior.
- Review Toss Login, IAP, promotion, and Smart Message docs for request/response
  or permission changes.
- Review `requestNotificationAgreement` and Smart Message intro docs for
  functional-message consent requirements before updating message templates.
- Review TDS package guidance before updating non-game app templates.
- Run consumer app smoke tests before raising any app-supported SDK/runtime
  version policy.
