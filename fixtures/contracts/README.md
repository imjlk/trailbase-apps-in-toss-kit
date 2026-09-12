# Apps in Toss Wire Contract Fixtures

`apps-in-toss.v1.json` is a curated synthetic corpus shared by Rust guest, proxy,
RN client transport and ledger diagnostic tests. It is not a recording of real
users, a generated description of current implementation, or a live provider test.

The IAP cases distinguish ledger status from verified provider evidence, including
all accepted aliases, explicit failure and successful payment without a provider
SKU. Message cases preserve partial channel delivery and classify an empty response
as UNKNOWN. Promotion cases prohibit a failure envelope from becoming a grant even
when a contradictory success status is present.

Keep response expectations independent from implementation. When a contract changes,
update the fixture and every relevant consumer together. Fixture edits trigger Rust,
JS and proxy workflows. Runtime/API tests must not grant based solely on these status
strings; ownership, SKU, consent, original transaction keys and existing transition
helpers remain required.

Run `cargo test --workspace` and
`bun test packages/trailbase-runtime packages/trailbase-client packages/ait-rn services/toss-mtls-client-proxy`.
The fixture schema is versioned; retain legacy cases when extending supported inputs.
