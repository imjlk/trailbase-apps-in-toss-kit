---
npm/@trailbase-apps-in-toss-kit/trailbase-runtime: patch
---

Fix dev runner reruns so ignored same-project containers keep their host ports,
normal runs do not inherit stale fresh-start tokens, and package lock metadata
includes all runtime CLI bins.
