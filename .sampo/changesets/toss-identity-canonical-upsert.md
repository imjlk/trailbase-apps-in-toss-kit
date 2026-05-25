---
cargo/trailbase-guest-common: minor
---

Preserve the existing active TrailBase `_user` as canonical when upserting a Toss identity for a
different anonymous `_user`, and return the canonical user from the shared helper.
