# Kit reference verification and evidence

Run the kit-owned reference from a committed checkout with the pinned Bun/Rust
runtime and Docker available:

```sh
bun install --frozen-lockfile
bun scripts/run-kit-reference.mjs --output /tmp/kit-reference.json
```

The command uses disposable Docker containers, a private Docker network, temporary
SQLite depots and synthetic SDK/provider fixtures. It never loads consumer checkout
paths, deploys a service, calls real Toss payments or uses production certificates.
The `Kit reference evidence` workflow runs it for reference changes and supports
manual dispatch before a release. Its redacted JSON artifact is retained for 30 days.

The report records the source commit, lockfile SHA-256 values, installed Bun/Node/
Rust/RN-minimum/RN-current/Web SDK versions, locked Rust crate/WASM versions,
observed server/proxy image IDs and disposable WASM fixture SHA-256 values,
individual check results and durations, browser bundle size and local fixture
measurements. The proxy is explicitly a source-built stub, not evidence that an
unreleased change is present in a published GHCR version. A source modification,
untracked source file or changed commit during verification prevents success.
Finder metadata and the requested report output are excluded from that source check.
Declared runtime bin files are executable so workspace linking preserves clean modes.

## Covered paths

- Shared Rust and JS tests, the actual minimum/current RN SDK and Web SDK types.
- Combined functional SQL migrations, including app rewards and operation policy.
- Real WASM anonymous stub verification, official TrailBase login/refresh,
  authentication/CSRF boundaries, private Record API ACL and SSE mutations.
- Server reward issuance, one-time local credit and receipt replay; separate normal
  and externally held operation modes. Held mode reports only the denial it exercises.
- Real WASI nonce generation, legacy v1/older-v2 key reads, transactionally saved
  reseal cursor and ciphertext, repeat no-op, unchanged HMAC/business timestamps and
  preservation of revoked erasure tombstones.
- Old-backup history-gap quarantine and original-ID reconciliation through runtime
  tests, plus the shared API fixtures and account/session lifecycle tests.
- Browser compilation of the Web adapter with module-graph verification excluding RN.

The crypto fixture is a separate WASM example under `trailbase-toss-identity` and
is marked disposable. Never install either compatibility guest in a consumer app.
All non-public identity and cursor values remain inside the temporary database;
the fixture endpoint emits only booleans and counts. Its synthetic keys are test
inputs, not configuration examples for production.

## Interpreting the measurements

`bun scripts/reference/benchmark.mjs` measures the actual private IAP diagnostic
lookup over 5,000 synthetic rows and the shared SSE parser over 2,000 events per
sample. It warms up first and reports p50/p95 elapsed milliseconds with sample
counts. These are local in-memory measurements; assertions are included in the
measured work. They are not production latency/throughput guarantees or a benchmark
of a consumer's network, device or provider. There is no machine-dependent pass
threshold. Compare the same fixture size/tool versions/runner when investigating a
regression. Bundle bytes include emitted code-split chunks and are uncompressed.

Use the source/image/version evidence when reviewing the generated Sampo release
PR. A successful run does not authorize publishing that PR, raising the minimum
TrailBase policy, enabling a feature, retiring keys or resuming recovered work.
Consumer QR/device checks, real mTLS readiness, operational restore protocols and
manual compatibility policy remain separate evidence. Keep failed reports too;
`ok: false` never counts as a verified release.
