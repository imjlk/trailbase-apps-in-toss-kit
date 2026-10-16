---
cargo/trailbase-guest-common: minor
npm/@trailbase-apps-in-toss-kit/trailbase-runtime: patch
---

Add `abandon_unexecuted_promotion_reward_ledgers_tx` to fail three-step promotion intents whose execution was never claimed and whose latest activity predates a cutoff. Recently resumed intents, started rows, and legacy rows remain untouched. Existing v2 consumers must apply the additive `promotion_reward_ledger.v3.sql` index migration before enabling bounded cleanup; fresh installs include the index. Ledger Doctor recognizes terminal `NOT_EXECUTED` rows without recommending a provider lookup or automatic retry.
