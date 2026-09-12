---
npm/@trailbase-apps-in-toss-kit/trailbase-client: minor
---

Add an optional account lifecycle that clears user caches and subscriptions,
isolates query keys by principal and session revision, ignores stale callbacks,
and refreshes backend entitlements and pending work before exposing a ready session.
On app foreground, revalidate the existing session instead of trusting cached SDK
subscription status. Disconnection clears local session credentials; server unlink,
revocation and anonymous-to-canonical data merge remain consumer responsibilities.

Session manager operations now supersede earlier operations, pass AbortSignal to
backend callbacks, and serialize storage writes so delayed responses cannot restore
an old account. Handle StaleAppSessionOperationError as cancellation, use one manager
per storage namespace, and route auth transitions through the lifecycle when adopted.
No SQL migration or proxy rollout is required.
