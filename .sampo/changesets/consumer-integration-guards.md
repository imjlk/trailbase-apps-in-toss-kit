---
npm/@trailbase-apps-in-toss-kit/ait-rn: patch
npm/@trailbase-apps-in-toss-kit/ait-web: patch
npm/@trailbase-apps-in-toss-kit/trailbase-client: minor
npm/@trailbase-apps-in-toss-kit/release-tools: minor
---

Add an optional snapshotMaxRecords guard that rejects oversized collection snapshots before reconciliation. Clarify full replacement versus single-page merging without changing defaults. Add a read-only Bun/Cargo release dependency guard that permits workspace version changes and rejects unrelated lockfile drift before publishing.

Adopt @ait-kit/sdk 0.5.1 with explicit React Native export conditions so consumers can remove their SDK package export patches.
