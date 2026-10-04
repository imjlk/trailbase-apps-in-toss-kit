# Affiliate product matching

Use `@trailbase-apps-in-toss-kit/trailbase-runtime/affiliate/matching` in a private backend or catalogue worker. The helpers accept normalized adapter products; they do not search a provider, issue credentials, persist records, or implement a Coupang adapter.

`matchAffiliateProducts` requires **both** a category (including its descendants) and a positive title keyword. NFKC, case and whitespace normalization supports simple lexical matching, not semantic relevance or synonym inference. Provider ordering is preserved. Consumers must review keywords and add exclusions for ambiguous words (for example, exclude “cover” when selecting pillows).

```js
import { matchAffiliateProducts, issueAffiliateCandidateLink }
  from '@trailbase-apps-in-toss-kit/trailbase-runtime/affiliate/matching';

const candidates = matchAffiliateProducts({
  categories: await provider.categories(),
  products: await provider.list({ source: 'category-best', categoryId }),
  categoryId, // An ID verified against this provider's actual category tree.
  keywords: ['pillow'],
  excludedKeywords: ['cover'],
  excludedCategoryIds: [],
  excludedProductIds: [],
  limit: 3,
});
const result = await issueAffiliateCandidateLink({
  candidates,
  issueLink: (id) => provider.issueLink(id),
  validateLink: isAllowedIssuedLink, // Synchronous provider-specific URL validator.
});
// result: { product, url, attempts }; product/url are null when exhausted.
```

The caller supplies `isAllowedIssuedLink`; require an issued HTTPS URL with the provider's exact allowed host, no credentials, controls or backslashes. Do not synthesize affiliate parameters. Provider adapters own authentication, request deadlines, cooldown and link expiry. Preserve method binding when passing `issueLink`, as in the example.

## Contract and limits

Products contain `id` (1–80 ASCII letters/digits/underscore/hyphen), `title` (1–180 characters without controls), `categoryIds` (up to 32 IDs), explicit `soldOut: false`, and optional finite epoch-millisecond `endAt`. Missing availability is excluded. Category nodes have an `id` and optional `children`; IDs must be unique. Unknown selected categories produce no matches. Excluded category subtrees override inclusion, even when an item also belongs to an allowed category.

Matching accepts at most 1,000 products and 1,000 category nodes, depth 8 (root depth 0), eight positive/excluded keywords each (2–40 characters), and 1,000 excluded product/category IDs each. Invalid configuration throws instead of broadening selection. Candidate `limit` defaults to 3, maximum 10. Duplicate eligible product IDs are removed. `now` is an epoch-millisecond number; `minValidityMs` defaults to 60 seconds.

Issuance accepts up to ten candidates and `maxAttempts` defaults to 3 (maximum 3). Invalid/expired/duplicate candidates do not consume attempts. It checks product validity both before and after awaiting the link. `now` is a clock function, unlike the matcher's numeric snapshot. Only `null` or an error whose `code` is `item-unavailable` permits the next candidate. Authentication, quota, transport and other errors propagate immediately; an invalid URL throws `invalid-link`. Do not log raw upstream errors. A caller-owned refresh loop must stop or respect adapter cooldown after global failure, rather than retrying all remaining rules.

The returned product is the original object; do not mutate inputs during issuance. Product `endAt` is not a guarantee of issued-link lifetime: persist an expiry bounded by both adapter link policy and product validity, then refresh/revalidate at use time. Database transactions, rule-revision compare-and-swap, manual-link priority, daily placements, CTR ranking and disclosure UI remain consumer-owned. No automatic change is made to the existing catalogue selector or consumer behavior.

Verify an integration with descendant-only products, ambiguous-keyword exclusions, sold-out/expired items, per-item rejection followed by success, and authentication/quota failures that issue no second request. Real provider approval, keys and issued-link smoke tests are still required before production enablement.
