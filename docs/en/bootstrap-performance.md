# Bootstrap latency

Use `TRAILBASE_AUTH_BASE_URL=http://127.0.0.1:4000` when the WASM guest and
TrailBase listener share a container. Pass it explicitly in **production** Compose
as well as local Compose. Keep `APP_BASE_URL` public for client-facing links.
An explicit existing Coolify value still overrides the Compose default: inspect
it before rollout. For a different port or topology, set the correct private
origin. Keep plain HTTP on loopback; require HTTPS or a trusted encrypted tunnel
for non-loopback auth traffic. Never assume the host's published port is the
container's listener port.

Preserve official `/api/auth/v1/login` and TrailBase password verification.
Use `ensure_verified_auth_user_tx` to reuse existing service accounts, then commit
before HTTP login. Pair this with
`login_anonymous_auth_user_with_password_rotation` and the configured previous
password secret. Do not replace intentional identity-link/password-rotation
upserts globally. Missing accounts still need password hashing; existing account
login still needs password verification. Neither operation may be bypassed to
improve a benchmark.

## Stage timing

`trailbase_guest_common::bootstrap_timing::BootstrapTiming` is available in the
kit. Older pinned consumers can copy `templates/trailbase/bootstrap_timing.rs`
into their WASM crate and declare `mod bootstrap_timing;` without upgrading
unrelated kit APIs or dependencies. The copy is consumer-owned; reconcile it
explicitly on later kit updates.

```rust,ignore
let mut timing = BootstrapTiming::new(
    settings::string("TRAILBASE_BOOTSTRAP_TIMING").as_deref() == Some("true"),
);
// Parse/validate, derive service credentials.
timing.transaction_starting();
let mut tx = db::tx()?;
timing.transaction_opened();
// Ensure account and assemble app-specific state.
db::tx_commit(&mut tx)?;
timing.transaction_committed();
let tokens = login_anonymous_auth_user_with_password_rotation(/* ... */).await?;
timing.auth_finished();
// Assemble the response.
timing.succeeded();
```

Instrument every successful/alias branch. The scope drops on early errors, too.
Set `TRAILBASE_BOOTSTRAP_TIMING=true` on the **TrailBase service** for a bounded
measurement window, then disable it. It defaults to off and writes one line to
stderr per bootstrap when enabled. It never accepts account identifiers, token
values, URLs or arbitrary error text. It adds no analytics or accounting rows.

The entrypoint must also serialize `TRAILBASE_BOOTSTRAP_TIMING` as the string `"true"` or `"false"` into `/settings.json`; WASM guests need not inherit container environment variables. Normalize this flag to those two literals before constructing JSON.

- `prepare_ms`: handler setup/body parsing before transaction acquisition.
- `transaction_open_ms`: acquiring the transaction, not a pure lock-wait metric.
- `transaction_ms`: database work **including commit**.
- `auth_ms`: HTTP login and any previous-secret retry/rehash, not pure network RTT.
- `response_ms`: work after login until the scope exits.
- `total_ms`: sum of these handler stages, excluding upstream proxy queues and
  response transport after return. `last_stage` and `status=error` identify where
  an early return occurred without exposing the error payload.

Compare first-time, repeated, linked and rotated-secret sessions separately.
Use p50/p95 across comparable warm production requests, and include error rate.
Do not subtract unrelated requests or equate local 20ms with production service
latency. These changes remove known avoidable work; a production improvement is
unverified until the new server is deployed and measured. Do not disable auth,
reuse another user's tokens, reduce password hash cost or hold transactions
across HTTP calls.
