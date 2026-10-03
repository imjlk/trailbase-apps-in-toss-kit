---
npm/@trailbase-apps-in-toss-kit/release-tools: minor
---

Add standalone local Cargo execution and read-only cache reporting tools. Share host targets, retain line-table debug information for routine checks, and support explicit full-debug and ephemeral modes without changing release profiles or global settings. Consumers may copy the standalone tools without updating runtime dependencies. Resolve artifact paths through Cargo metadata and stage Docker WASM within the locked cache-mount build step; review bounded BuildKit GC settings separately from application data volumes.
