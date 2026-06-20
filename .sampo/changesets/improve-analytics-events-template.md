---
cargo/trailbase-guest-common: minor
---

Add the recommended `analytics.events` table helper and SQL template, keep the
legacy `analytics.analytics_events` path compatible, and optimize analytics
batch insert helpers to reuse table validation and insert SQL per batch.
