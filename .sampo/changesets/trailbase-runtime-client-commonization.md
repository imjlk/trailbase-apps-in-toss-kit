---
npm/@trailbase-apps-in-toss-kit/trailbase-runtime: minor
npm/@trailbase-apps-in-toss-kit/trailbase-client: minor
---

Add shared TrailBase runtime helpers, production env validation, local dev port
resolution, and React Native client adapter utilities for consumer apps.

This also hardens the shared helpers for reuse across more apps by preserving
explicit local URL ports, serializing JSON request bodies, passing XHR SSE
headers, and surfacing XHR SSE HTTP failures as TrailBase errors.
