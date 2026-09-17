---
cargo/trailbase-guest-common: patch
npm/@trailbase-apps-in-toss-kit/toss-mtls-client-proxy: patch
---

Address the post-merge review findings on the promotion v2 breaking change.

- **Migration fix (P1) — legacy rows are never adopted**: the v2 key
  store only accepts rows the v2 insert stamped `three-step`; legacy rows
  keyed or keyless stay fenced because both shapes can hide an executed
  grant. `promotion_reward_ledger.v2.sql` wraps its
  statements in a SAVEPOINT — standalone application gets full-transaction
  semantics (interrupted runs roll back and are retryable; apply with
  `sqlite3 --bail ... ".read ..."`), and migration runners that already
  wrap each file in a transaction nest cleanly instead of failing. The
  migration performs **no protocol backfill**: a pending row with a stored
  key and `provider_status = 'PREPARED'` is not provably pre-execution
  (the 0.11 store-key fence admitted `PENDING` too, so an
  executed-then-PENDING row could read `PREPARED` after a same-key store
  replay), and backfilling it would make it v2-claimable and re-executable
  — a double grant. **Drain before upgrading** while the 0.11 helpers
  still run, and drain **every legacy row, keyed or keyless — PREPARED
  included**: keyed rows settle through the status lookup with their
  stored key, and keyless rows require explicit provider/operator
  reconciliation (no status key exists — they may be grants that executed
  before the key was persisted). PREPARED cannot distinguish a
  never-executed key from the executed-then-PENDING replay state — resuming or
  re-adopting either shape can double-grant. The v2 key store now only
  accepts rows the v2 flow itself created (`protocol = 'three-step'` at
  insert), so legacy rows are never adopted, keyed or keyless. The
  migration test covers every legacy row class staying unmarked and
  unclaimable.
- **Prepare redaction (P2)**: recipient-bound prepare responses now run the
  same provider-echo redaction as execute and status — a get-key rejection
  embedding the submitted `anonKey`/`tossUserKey` in its failure reason no
  longer leaks the raw identifier into logs or persisted error JSON.
- **Numeric/short recipient redaction (P2)**: short and all-digit ids no
  longer feed the recursive substring redactor — a recipient like `1`
  previously rewrote unrelated fields such as
  `providerTransactionKey: "key-1"` into `key-[redacted]`, and an
  all-digit id of any length can substring-match inside transaction keys.
  Substring redaction now applies only to identifier strings of meaningful
  length that contain non-digits (anonymous keys, raw Toss user keys, long
  userKey hashes — the string `userKey` spelling stays redacted); the proxy
  never echoes the caller's request body back, so numeric app-side user ids
  get no rewriting instead of corrupting responses. All three promotion
  endpoints share one redaction helper.
- **Docs (P2)**: the anonymous-identity guidance (EN/KO) no longer describes
  the removed proxy-side prepare → execute → status orchestration or
  recommends pre-v2 proxy versions; it now requires the versioned
  `promotion.prepare.v2`/`execute.v2`/`status.v2` capabilities and documents
  caller-owned sequencing.
