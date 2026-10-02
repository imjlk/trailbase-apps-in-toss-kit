# Server-side affiliate catalog selection

The `trailbase-runtime/affiliate/*` modules add optional server-side product selection.
The existing RN `ait-rn/shopping` bridge still only validates and opens explicit links.
No certificates, mTLS proxy changes, database migrations, purchase rewards or user
identities are involved. The first live adapter is Toss Shopping Sharelink. The
selection contract supports additional providers; **a Coupang adapter is not included**.

## Responsibilities

- Provider adapter: authentication, taxonomy, supported sources, response validation,
  issued tracking links and freshness limits. `productUrl` is never an affiliate link.
- Common selector: topic/default category groups, source weighting, exclusions,
  bounded candidate rotation, no-offer fallback and stable navigation keys.
- Consumer: derive non-sensitive topic IDs from eligible public content, authorize
  requests, choose placements and fallback UI, operate the private service and cache.

Import `createTossSharelinkProvider`, `createAffiliateCatalog`,
`createAffiliateCache` and `createAffiliateService` from their corresponding
`@trailbase-apps-in-toss-kit/trailbase-runtime/affiliate/{toss-sharelink,selection,cache,service}`
entrypoints. No new dependencies are required; use Bun or a modern Node server.

```js
const cache = createAffiliateCache({ directory: '/private/affiliate-cache' });
const provider = createTossSharelinkProvider({ accessKey, secretKey, publisherId,
  subTagId, cache });
const catalog = createAffiliateCatalog({ provider, cache, policy: {
  groups: {
    household: { categoryIds: approvedHouseholdCategoryIds },
    food: { categoryNames: ['식품'] },
  },
  defaultGroups: ['household', 'food'],
  sourceWeights: { 'category-best': 1, 'today-deals': 1 },
  allowOverallBest: false,
  excludedCategoryIds: [], blockedProductIds: [],
} });
const fetch = createAffiliateService({ catalog, token: internalToken, enabled: true });
```

Resolve real category IDs from the provider taxonomy. Exact normalized names are
also supported, but sample names are not a guarantee of a match. Parent exclusions
exclude descendants. Unmatched categories return no offer; they never silently
enable the overall bestseller list. Supported source weights are integer 0–10.
Unavailable sources are skipped. One request considers at most three related and
three default categories, the first 30 provider products per list and three link
issuance candidates. This is bounded discovery, not an exhaustive product search.

The consumer supplies `{topics, rotationKey, excludeProductIds}` to authenticated
`POST /select`. Keep one navigation key per mounted placement; rotate on a new
visit. Source/category selection is deterministic for that key. Recent exclusions
are strict: exhausting them returns no offer rather than forcing repeated products.
Expired, sold-out, blocked and unmapped deal candidates are excluded. A deal must
have at least five minutes remaining. Offers expire within five minutes. Consumers
must remove expired offers and check again before opening, without auto-navigation.

`GET /health` reports only mode/protocol readiness, **not** live approval or upstream
connectivity. Keep the service private, pass a separate internal bearer token of at
least 24 characters, and authenticate users in the consumer API. Never allow the
browser to submit arbitrary provider paths, target URLs, credentials or private text.

## Toss setup and limits

Use [Sharelink approval and credentials](https://sharelink-docs.toss.im/developers/open-api/auth):
approved service/placements, Access Key, Secret Key, publisher ID and registered
server egress IP. This uses OAuth at `https://oauth2.cert.toss.im/token`, not the
Apps in Toss mTLS API. Production is the only official API environment. Optional
`subTagId` must already be registered; it can separate consumer apps' reporting.

The adapter validates HTTP status **and** `resultType`; HTTP 200 FAIL is never
accepted. No-code link refusals temporarily exclude the item. Other errors stop
selection and open a cooldown; daily quota errors wait for the KST reset. There is
no blind inline retry. OAuth refresh is single-flight and an HTTP 401 invalidates
the cached token for a later request. Provider error bodies/secrets are not returned.

Category trees and category best lists are cached for 24 hours, overall best for an
hour and deals for 15 minutes. Selection checks each deal's `endAt` independently.
Issued links are reused; OAuth tokens are cached until shortly before expiry. File
cache entries use atomic rename and private permissions, including the bearer
credential. Mount a private persistent directory, never serve or commit it, and
retain one cache per provider account. There is one serialized 4 rps queue **per
provider instance**; shared-account multi-instance deployments must coordinate
their aggregate quota or use a single catalog service. Current official limits
and usage/image permissions remain governed by the
[provider contract](https://sharelink-docs.toss.im/developers/open-api/convention).

No prices or images are included in the public offer contract in this iteration.
Use approved product title, source label, explicit CTA and commission disclosure.
Prices/availability at checkout and realized revenue belong to the provider.

## Development

A consumer may inject a fixture provider with `preview: true`; offers then have
`url: null` and never call link issuance. Reject mock mode in production. RN
`normalizeAppsInTossShoppingOffer(value, {allowPreview})` defaults to rejecting
previews; enable only for local development, disable clicks and analytics for them.

Run `bun test packages/trailbase-runtime/test/affiliate.test.mjs` and
`bun test packages/ait-rn/test/shopping-offer.test.ts`. These tests inject transport
and providers. They do not prove live credentials, approval, attribution or payment.

Cache memory is bounded (512 entries by default). Periodic writes prune expired
files and trim persisted entries to the same bound; up to 63 newer writes can be
present between sweeps. Use a private directory owned by this cache instance.
Adapters without a positive source TTL default to one hour. An optional catalog
`onError` sink receives only `{ code: 'selection-failed', stage, retryAt }`, not
raw errors, context or credentials; sync/async sink failures are isolated.

A selected parent category includes descendant-tagged products, even if a provider
omits the parent ID from a product's `categoryIds`. The same tree relationship is
used when matching today's deals; unrelated categories do not qualify.

For read-only policy and candidate checks, see [affiliate diagnostics](affiliate-diagnostics.md).
