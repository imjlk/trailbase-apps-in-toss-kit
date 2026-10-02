# Engagement signals in consumer apps

`@trailbase-apps-in-toss-kit/ait-rn/engagement` provides small, optional
controllers. Consumers own their routes, account state, query caches, and UX.
These helpers do not restore screens, submit scores, grant rewards, or replay
mutations. They require no server migration or SDK dependency upgrade.

## Entry channel and actual exposure

Capture the initial `scheme` from Granite `InitialProps` at app startup and pass
it to `entryReferrerFromScheme`. The helper retains only documented entry-channel
values. Missing, duplicated, malformed, or unrecognized referrers become
`unknown`. This is distinct from the login API's `DEFAULT`/`SANDBOX` referrer.
Store this session attribution in memory and attach it to your existing analytics
events. Never attach the launch URL, arbitrary query parameters, or private poll
content. Referrer is a client analytics hint, not trusted authorization data.

Use Granite `ImpressionArea` inside `IOScrollView` (or `InView` in its supported
IO container). Feed the conjunction of viewport visibility and screen visibility
to `createExposureTracker().setVisible()`. The default requires 1 second of
continuous visibility and emits once per tracker instance. Consumers choose the
viewport threshold, identity, and callback. Dispose on unmount; backgrounding or
leaving the viewport cancels the dwell timer. Async telemetry failures are isolated.
Keep mount/render, actual exposure, click, dispatch, and confirmed business outcomes
as separate events. An SDK ad impression callback remains the source for ad impressions.

## Foreground and connectivity

Create one `createForegroundRefreshController` per screen lifecycle. Inject
`safeGetAppsInTossNetworkStatus` from `ait-rn/runtime`, a **read-only** refresh
callback, and an optional `onStatus` observer. Call `setActive` with SDK screen
visibility and an account/session context key; block it while a mutation or
blocking overlay is active. Initial activation probes connectivity without
duplicating the initial query. Returning refreshes at most once per 15 seconds
by default; `retry()` explicitly bypasses that cooldown.

`OFFLINE` skips refresh. `UNKNOWN`, absent APIs, errors, and a stalled native probe
allow normal reads so SDK detection never locks the app out. Network availability
does not prove your API is reachable. No network-change subscription is inferred:
the controller probes on activation and explicit retry. Read errors are reported
separately. Dispose on unmount; late probe/status results from an old context are
ignored. Query cancellation and account-specific cache isolation remain app-owned.

## Review requests

Reuse the [review controller](review-request.md) with `@ait-kit/sdk/rn` instead of
implementing the native review bridge again. Copy both the `.mjs` controller and
its `.d.mts` declaration for TypeScript consumers. The controller checks the
screen/account again after the asynchronous cooldown write. A skipped stale request
keeps that conservative attempt timestamp. Eligibility, cooldown, and modal checks
belong to the app. A resolved request never proves a review was shown or written.

Sources: [review](https://developers-apps-in-toss.toss.im/documentation/common/growth/review),
[exposure](https://developers-apps-in-toss.toss.im/documentation/react-native/impression),
[referrer](https://developers-apps-in-toss.toss.im/documentation/common/growth/analytics/referrer),
[visibility](https://developers-apps-in-toss.toss.im/documentation/react-native/screen-navigation/event),
[network](https://developers-apps-in-toss.toss.im/documentation/common/network-environment/network).
