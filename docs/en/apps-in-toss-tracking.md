# Apps in Toss Upstream Tracking

This repository is a reusable TrailBase integration kit for Apps in Toss
services. It does not vendor the Apps in Toss React Native SDK, Granite runtime,
or TDS packages. Consumer apps own those dependencies and should update them
only after app-level smoke tests.

## Official Upstream Sources

- Release notes: https://developers-apps-in-toss.toss.im/release-note.md
- LLM index: https://developers-apps-in-toss.toss.im/llms.txt
- React Native tutorial: https://developers-apps-in-toss.toss.im/tutorials/react-native.md
- SDK overview: https://developers-apps-in-toss.toss.im/bedrock/reference/framework/시작하기/intro.md
- API overview: https://developers-apps-in-toss.toss.im/api/overview.md
- mTLS integration process: https://developers-apps-in-toss.toss.im/development/integration-process.md
- Toss Login: https://developers-apps-in-toss.toss.im/login/develop.md
- In-app purchase: https://developers-apps-in-toss.toss.im/iap/develop.md
- Promotion: https://developers-apps-in-toss.toss.im/promotion/develop.md
- Smart Message: https://developers-apps-in-toss.toss.im/smart-message/develop.md
- Smart Message overview and notification agreement policy: https://developers-apps-in-toss.toss.im/smart-message/intro.md
- Notification agreement SDK: https://developers-apps-in-toss.toss.im/bedrock/reference/framework/인터렉션/requestNotificationAgreement.md
- Non-game user identity key: https://developers-apps-in-toss.toss.im/bedrock/reference/framework/비게임/getAnonymousKey.md
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
- `apps-in-toss-framework`: `2.10.1`

<!-- renovate: datasource=npm depName=@toss/tds-react-native versioning=npm -->
- `tds-react-native`: `2.0.3`

<!-- renovate: datasource=npm depName=create-granite-app versioning=npm -->
- `create-granite-app`: `1.0.33`

<!-- renovate: datasource=npm depName=@granite-js/react-native versioning=npm -->
- `granite-js-react-native`: `1.0.33`

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
`2.10.1`.

- `2.8.0`: Added non-game navigation bar theme settings.
- `2.9.0`: Added the `ait deploy --timeout` option for app bundle deployment.
- `2.9.2`: Game apps now show an exit confirmation modal when the Toss app
  navigation bar X button is pressed. Non-game apps still exit directly.
- `2.10.1`: Refreshes the tracked Apps in Toss reference package family for
  metadata validation. Consumer apps should review upstream SDK notes and run
  app-level smoke tests before adopting it.

No shared kit API change is required for these SDK deltas. Consumer apps should
still run app-level smoke tests before raising their own supported Apps in Toss
SDK/runtime policy.

## Doc Watch Outputs

The `Apps in Toss doc watch` workflow writes upstream snapshots to:

- `data/upstream/apps-in-toss/docs-snapshot.md`
- `data/upstream/apps-in-toss/docs-snapshot.json`

The snapshot stores document hashes and npm reference package metadata. It does
not copy full upstream documents into this repository.

The workflow currently reuses `TRAILBASE_RELEASE_WATCH_TOKEN` as the upstream
watch PR token. That token must be able to push branches and open pull requests
for this repository so generated PRs trigger downstream `pull_request` checks.

## Review Checklist When Apps in Toss Changes

- Check release notes for SDK 2.x, Granite, or required migration changes.
- Check whether React Native, React, or Toss app minimum versions changed.
- Check mTLS API integration process changes before modifying proxy behavior.
- Review Toss Login, IAP, promotion, and Smart Message docs for request/response
  or permission changes.
- Review `requestNotificationAgreement` and Smart Message intro docs for
  functional-message consent requirements before updating message templates.
- Review TDS package guidance before updating non-game app templates.
- Run consumer app smoke tests before raising any app-supported SDK/runtime
  version policy.
