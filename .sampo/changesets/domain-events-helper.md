---
cargo/trailbase-guest-common: minor
---

Add generic TrailBase domain event helpers for app-owned event history tables,
including safe SQL identifier validation, insert/list statement builders, and
schema guidance that keeps server-side ledgers separate from AppsInToss
Analytics.
