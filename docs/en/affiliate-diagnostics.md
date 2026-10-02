# Affiliate diagnostics

The `affiliate-doctor` command validates the same category policy and previews the
same selector used by the live catalog. It does **not** issue links, open a shopping
app, verify purchases, or change provider settings.

```sh
node packages/trailbase-runtime/bin/affiliate-doctor.mjs --policy path/to/policy.json
node packages/trailbase-runtime/bin/affiliate-doctor.mjs --policy path/to/policy.json --topics cleaning --live
```

The default is offline structural validation. `--live` explicitly enables read
requests with server-only `TOSS_SHOPPING_ACCESS_KEY`, `TOSS_SHOPPING_SECRET_KEY`,
`TOSS_SHOPPING_PUBLISHER_ID` and optional registered `TOSS_SHOPPING_SUB_TAG_ID`.
Use it on the registered egress server. Never copy these values into frontend env.

Output is JSON. `incomplete` means only configuration was checked; `ready` means
read-only category/product selection succeeded. Neither proves link issuance,
service approval or revenue attribution. `linkIssuanceTested` remains false and
preview `url` remains null. Results contain group/category IDs and public product
names, with no bearer tokens, secret values, native errors or tracking links.

- `invalid-policy`: correct the reported field path.
- `authentication-or-permission`: check credentials and API scopes.
- `access-denied`: check registered server egress IP and account/service access.
- `quota-exceeded` / `rate-limited`: wait for the provider limit to reset.
- `unmatched-or-excluded-category`: compare configured groups with the actual tree.
- `no-eligible-product`: no candidate survived the selection policy; existing ads should remain available.
- `transport` / `provider-unavailable`: check server connectivity and provider status.

The library exports `diagnoseAffiliateCatalog` and `validateAffiliatePolicy` from
`trailbase-runtime/affiliate/diagnostics`. Consumers can inject their development
fixture provider and label `mode: 'fixture'`, reusing their actual policy. The
normal `issueLink` implementation is never called, even for a live adapter.

Exit codes: 0 for ready/warning/offline-incomplete reports, 1 for a failed check,
2 for invalid CLI arguments. Handle the report's status instead of interpreting
exit 0 as full production readiness.
