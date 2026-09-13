---
npm/@trailbase-apps-in-toss-kit/trailbase-client: patch
---

Accept the official TrailBase 0.14 record API as the RN XHR SSE fallback without requiring it to implement the adapter's AbortSignal option. Cancellation remains handled by the XHR adapter and collection lifecycle; no app-local type cast is needed when upgrading the SDK.
