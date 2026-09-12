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
Multi-key writes share one queue slot, and a persistent writePending marker blocks
restoration of partially written credentials. Keep the marker with the session
namespace and handle AppSessionStorageIncompleteError with clear/sign-in recovery.
Preserve stored credentials on transient restore/foreground failures; provide
isInvalidSessionError for custom authoritative revocation errors. Disconnect still
attempts credential deletion when resource cleanup fails, and explicit anonymous
bootstrap cannot make a partially written Toss mirror valid again.
