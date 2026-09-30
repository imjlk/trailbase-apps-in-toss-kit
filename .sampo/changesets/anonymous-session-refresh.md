---
npm/@trailbase-apps-in-toss-kit/trailbase-client: minor
npm/@trailbase-apps-in-toss-kit/ait-rn: minor
---

Restore anonymous app sessions through the official TrailBase token refresh endpoint instead of repeating password login. Add optional refresh integration, shared concurrent acquisition, explicit renewal and canonical account adoption while preserving credentials during transient failures. Consumers must supply an authenticated initial-data endpoint and narrowly classify invalid credentials; no SQL migration or server upgrade is required.

React Native consumers can enable `revalidateAnonymousHash` on session storage to verify the current SDK identity before restoration and invalidate both credential mirrors when the account changes. SDK or storage failures do not fall back to another identity.
