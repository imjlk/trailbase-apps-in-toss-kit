---
cargo/trailbase-guest-common: patch
---

Add opt-in bootstrap stage diagnostics and a dependency-free copy-in template. Use an internal TrailBase auth origin, preserve official login/password rotation, and compare stage timings before attributing production latency to network or database work.
