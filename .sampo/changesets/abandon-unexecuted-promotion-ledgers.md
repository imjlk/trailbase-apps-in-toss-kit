---
cargo/trailbase-guest-common: minor
---

Add `abandon_unexecuted_promotion_reward_ledgers_tx` to fail three-step promotion intents whose execution was never claimed, so an abandoned prepare no longer leaves a pending row that blocks later claims. The execute claim only accepts pending rows, so abandoned rows can never execute; started and legacy rows are untouched.
