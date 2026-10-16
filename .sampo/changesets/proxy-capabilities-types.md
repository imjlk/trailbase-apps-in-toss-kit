---
npm/@trailbase-apps-in-toss-kit/trailbase-runtime: patch
---

Provide TypeScript declarations for the proxy-capabilities package export so
strict Bundler and NodeNext consumers no longer need a local ambient module shim.
Type both the health evaluator and check factory, including fetch injection and
success/failure result narrowing. JavaScript behavior and credential handling are
unchanged.
