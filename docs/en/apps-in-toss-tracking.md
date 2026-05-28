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
- TDS React Native docs: https://tossmini-docs.toss.im/tds-react-native/

## Compatibility Policy

- Consumer SDK, Granite, and TDS package versions are app-owned.
- Do not add `@apps-in-toss/framework`, `@granite-js/react-native`, or TDS packages
  to this kit's runtime dependencies just to track upstream.
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
  Keep the agreement `templateCode` distinct from the message `templateSetCode`.
- `requestNotificationAgreement` is documented for React Native and WebView SDK
  v2.5.0 or newer. Do not enable user-requested functional alert flows on older
  consumer SDK versions.

## Renovate-Tracked Reference Versions

<!-- renovate: datasource=npm depName=@apps-in-toss/framework versioning=npm -->
- `apps-in-toss-framework`: `2.6.1`

<!-- renovate: datasource=npm depName=@toss/tds-react-native versioning=npm -->
- `tds-react-native`: `2.0.3`

<!-- renovate: datasource=npm depName=create-granite-app versioning=npm -->
- `create-granite-app`: `1.0.29`

<!-- renovate: datasource=npm depName=@granite-js/react-native versioning=npm -->
- `granite-js-react-native`: `1.0.29`

- `@toss-design-system/react-native`: legacy package name for pre-1.0 framework
  projects. No public npm `latest` metadata was available during the initial
  tracking snapshot, so new apps should not use it as the active reference.

If you edit these Renovate marker blocks or `renovate.json`, validate the
configuration with `bun run renovate:validate`.

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
