// Matching is deterministic lexical filtering, not a semantic recommendation.
const normalize = (text) => text.normalize('NFKC').toLowerCase().replace(/\s+/gu, '');
const id = (value) => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(value);
const terms = (values, required = false) => {
  if (!Array.isArray(values) || values.length > 8 || (required && !values.length) ||
      values.some((value) => typeof value !== 'string' || value.trim().length < 2 || value.length > 40 || /\p{Cc}/u.test(value))) {
    throw new TypeError('Expected up to eight keywords of 2–40 characters');
  }
  return values.map(normalize);
};
const bound = (value, max, name) => {
  if (!Number.isInteger(value) || value < 1 || value > max) throw new TypeError(`Invalid ${name}`);
  return value;
};
const validProduct = (product, now, minValidityMs) => product && id(product.id) &&
  typeof product.title === 'string' && product.title.trim().length > 0 && product.title.length <= 180 &&
  !/\p{Cc}/u.test(product.title) && product.soldOut === false &&
  Array.isArray(product.categoryIds) && product.categoryIds.length <= 32 && product.categoryIds.every(id) &&
  (product.endAt === undefined || (Number.isFinite(product.endAt) && product.endAt > now + minValidityMs));

/** Match a consumer-approved category and keywords against normalized adapter
 * products. Provider order is retained; unknown categories never mean all items. */
export function matchAffiliateProducts({ products, categories, categoryId, keywords,
  excludedKeywords = [], excludedCategoryIds = [], excludedProductIds = [],
  now = Date.now(), minValidityMs = 60_000, limit = 3 }) {
  bound(limit, 10, 'candidate limit');
  if (!Number.isFinite(now) || !Number.isFinite(minValidityMs) || minValidityMs < 0 ||
      !Array.isArray(products) || products.length > 1000 || !Array.isArray(categories) || !id(categoryId) ||
      !Array.isArray(excludedCategoryIds) || excludedCategoryIds.length > 1000 || !excludedCategoryIds.every(id) ||
      !Array.isArray(excludedProductIds) || excludedProductIds.length > 1000 || !excludedProductIds.every(id)) {
    throw new TypeError('Invalid matching input');
  }
  const wanted = terms(keywords, true), unwanted = terms(excludedKeywords);
  const selected = new Set(), forbidden = new Set(excludedCategoryIds), visited = new Set();
  let count = 0;
  function walk(nodes, inside = false, blocked = false, depth = 0) {
    if (!Array.isArray(nodes) || (depth > 8 && nodes.length > 0)) throw new TypeError('Invalid category tree');
    for (const node of nodes) {
      if (++count > 1000 || !node || !id(node.id) || visited.has(node.id)) throw new TypeError('Invalid category tree');
      visited.add(node.id);
      const denied = blocked || forbidden.has(node.id);
      if (denied) forbidden.add(node.id);
      const related = inside || node.id === categoryId;
      if (related && !denied) selected.add(node.id);
      if (node.children !== undefined) walk(node.children, related, denied, depth + 1);
    }
  }
  walk(categories);
  const blockedProducts = new Set(excludedProductIds), seen = new Set(), result = [];
  for (const product of products) {
    if (!validProduct(product, now, minValidityMs) || seen.has(product.id) || blockedProducts.has(product.id) ||
        product.categoryIds.some((value) => forbidden.has(value)) || !product.categoryIds.some((value) => selected.has(value))) continue;
    const title = normalize(product.title);
    if (!wanted.some((term) => title.includes(term)) || unwanted.some((term) => title.includes(term))) continue;
    seen.add(product.id);
    result.push(product);
    if (result.length === limit) break;
  }
  return result;
}

/** Bounded issuance. Only explicit per-item unavailability permits fallback.
 * The adapter owns URL validation, authentication, cooldown and request timeout.
 * Throws global errors unchanged: callers must not log raw upstream errors. */
export async function issueAffiliateCandidateLink({ candidates, issueLink, validateLink,
  maxAttempts = 3, now = Date.now, minValidityMs = 60_000 }) {
  bound(maxAttempts, 3, 'issuance attempts');
  if (!Array.isArray(candidates) || candidates.length > 10 || typeof issueLink !== 'function' ||
      typeof validateLink !== 'function' || typeof now !== 'function' || !Number.isFinite(minValidityMs) || minValidityMs < 0) {
    throw new TypeError('Invalid issuance input');
  }
  let attempts = 0;
  const seen = new Set();
  for (const product of candidates) {
    const before = now();
    if (!Number.isFinite(before)) throw new TypeError('Invalid clock');
    if (!validProduct(product, before, minValidityMs) || seen.has(product.id)) continue;
    if (attempts >= maxAttempts) break;
    seen.add(product.id);
    attempts++;
    let url;
    try { url = await issueLink(product.id); } catch (error) {
      if (error?.code === 'item-unavailable') continue;
      throw error;
    }
    if (url === null) continue;
    if (typeof url !== 'string' || validateLink(url) !== true) {
      const error = new Error('Affiliate adapter returned an invalid link');
      error.code = 'invalid-link';
      throw error;
    }
    const after = now();
    if (!Number.isFinite(after)) throw new TypeError('Invalid clock');
    if (!validProduct(product, after, minValidityMs)) continue;
    return { product, url, attempts };
  }
  return { product: null, url: null, attempts };
}
