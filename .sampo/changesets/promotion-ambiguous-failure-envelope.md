---
cargo/trailbase-guest-common: patch
npm/@trailbase-apps-in-toss-kit/ait-rn: patch
---

Promotion outcome parsing no longer finalizes a bare `ok:false` envelope as `FAILED`. Proxy timeouts, auth or 5xx errors, and contradictory statuses now normalize to `UNKNOWN` (ledger `pending`) so a status lookup settles them and callers never re-grant a reward that may already be paid; only an explicit `FAILED`/`ERROR` provider status stays terminal. The functional message client's `requestMessage` endpoint is now optional for apps whose server queues messages itself.
