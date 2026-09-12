---
cargo/trailbase-guest-common: minor
cargo/trailbase-toss-identity: minor
npm/@trailbase-apps-in-toss-kit/trailbase-client: minor
npm/@trailbase-apps-in-toss-kit/toss-mtls-client-proxy: minor
---

Recover TanStack collections after SSE disconnects using complete paginated
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
and response-header waits with a configurable 15-second connection deadline.
