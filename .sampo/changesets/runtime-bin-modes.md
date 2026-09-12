---
npm/@trailbase-apps-in-toss-kit/trailbase-runtime: patch
---

Keep declared Node CLI entrypoints executable in the source checkout, so frozen
Bun workspace installation does not alter their tracked file modes before reference
verification. Direct Node and package-bin invocation behavior is otherwise unchanged.
