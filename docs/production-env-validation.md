# Production Env Validation

Production env validation is split between shared safety rules and
consumer-specific app rules.

The shared runtime validator covers rules that repeat across TrailBase
AppsInToss services:

- parse dotenv-style files without expanding secrets
- require values and secret-like values
- reject placeholder and local development values
- require HTTPS for public URLs
- require positive integers for limits and timeouts
- validate `TRAILBASE_FRESH_START_*` semantics
- validate `TRAILBASE_SYNC_CONFIG`
- validate `TRAILBASE_DEV_ADMIN_*` is not enabled in production
- reject moving mTLS proxy image tags such as `latest` and `edge`
- validate `MTLS_PROXY_*` and `COMPOSE_PROFILES` combinations

Consumers should keep wrapper scripts for app-specific keys and policies. For
example, a game might require reward or inventory settings while another app
only needs Toss Login and IAP.

## Moving Image Tags

Production should use exact SemVer or, when intentional, a minor SemVer tag:

```text
ghcr.io/imjlk/trailbase-apps-in-toss-kit/toss-mtls-client-proxy:0.1.1
ghcr.io/imjlk/trailbase-apps-in-toss-kit/toss-mtls-client-proxy:0.1
```

Moving tags are for deliberate testing and CI workflows:

```text
edge
latest
```

Example files may use placeholders when the validator is run with
`--allow-placeholders`. Real production env files should fail when placeholders,
local URLs, dev tokens, or moving image tags are present.

## Fresh Start Rules

Fresh start requires both a token and a confirmation value. A token alone should
not reset data. Reusing the same token should not reset again after the marker
has been written.

Consumers should document their confirmation variable name. The shared validator
supports checking this pattern, but the consumer decides whether the feature is
allowed in a given environment.

## Extending Rules

Consumer wrappers should import the shared validator and add app-specific rules
as small functions. Keep wrapper output human-readable and deterministic so it
is useful in CI, local shells, and deployment runbooks.
