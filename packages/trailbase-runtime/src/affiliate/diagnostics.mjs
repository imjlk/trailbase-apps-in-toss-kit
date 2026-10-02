import { createAffiliateCatalog, flattenAffiliateCategories, resolveAffiliateCategories } from './selection.mjs';

const object = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const list = (v) => Array.isArray(v) && v.length <= 40 && v.every((s) => typeof s === 'string' && s.trim() && s.length <= 100);
const topic = (v) => typeof v === 'string' && /^[a-z0-9-]{1,40}$/.test(v);
const sources = ['category-best', 'today-deals'];

/** Offline structural validation; reports field paths, never config values. */
export function validateAffiliatePolicy(policy) {
  const issues = [];
  const invalid = (path) => issues.push({ code: 'invalid-policy', path });
  if (!object(policy)) return [{ code: 'invalid-policy', path: 'policy' }];
  if (!object(policy.groups) || Object.keys(policy.groups).length > 40) invalid('groups');
  else for (const [id, group] of Object.entries(policy.groups)) {
    if (!topic(id)) { invalid('groups.key'); continue; }
    if (!object(group) || (group.categoryIds !== undefined && !list(group.categoryIds)) ||
      (group.categoryNames !== undefined && !list(group.categoryNames)) ||
      !(group.categoryIds?.length || group.categoryNames?.length)) invalid(`groups.${id}`);
  }
  if (!list(policy.defaultGroups) || !policy.defaultGroups.every((id) => topic(id) && Object.hasOwn(policy.groups ?? {}, id))) invalid('defaultGroups');
  for (const name of ['excludedCategoryIds', 'blockedProductIds']) {
    if (policy[name] !== undefined && !list(policy[name])) invalid(name);
  }
  if (policy.allowOverallBest !== undefined && typeof policy.allowOverallBest !== 'boolean') invalid('allowOverallBest');
  if (policy.sourceWeights !== undefined && !object(policy.sourceWeights)) invalid('sourceWeights');
  else {
    const weights = { 'category-best': 1, 'today-deals': 1, ...policy.sourceWeights };
    if (Object.entries(weights).some(([key, weight]) => !sources.includes(key) || !Number.isInteger(weight) || weight < 0 || weight > 10)) invalid('sourceWeights');
    else if (!Object.values(weights).some((weight) => weight > 0) && policy.allowOverallBest !== true) invalid('sourceWeights.empty');
  }
  return issues;
}

/** Error categories are allowlisted: never serialize upstream Error/message/body. */
export function affiliateDiagnosticFailure(error) {
  const code = error?.code;
  if (code === 'access-denied') return 'access-denied';
  if (code === 'quota-exceeded') return 'quota-exceeded';
  if (['http-400', 'http-401', 'http-403', 'invalid-token'].includes(code)) return 'authentication-or-permission';
  if (code === 'http-429') return 'rate-limited';
  if (['transport', 'cooldown'].includes(code)) return code;
  return 'provider-unavailable';
}

/** Read-only diagnostic selection. Even a live adapter's issueLink is never
 * called; returned previews have no URL and cannot be used as affiliate links. */
export async function diagnoseAffiliateCatalog({ policy, provider, topics = [], rotationKey = 'diagnostic',
  now = Date.now, mode = provider ? 'read-only' : 'configuration' }) {
  const checks = [];
  const validMode = ['configuration', 'read-only', 'fixture'].includes(mode);
  const report = { schema: 'affiliate-diagnostics-v1', mode: validMode ? mode : 'configuration', checks, mappings: [], preview: null,
    linkIssuanceTested: false, status: 'ready' };
  const add = (id, status, code) => checks.push({ id, status, code });
  const issues = validateAffiliatePolicy(policy);
  if (!validMode) issues.push({ code: 'invalid-context', path: 'mode' });
  if (!Array.isArray(topics) || topics.length > 6 || !topics.every(topic)) issues.push({ code: 'invalid-context', path: 'topics' });
  if (typeof rotationKey !== 'string' || !/^[a-zA-Z0-9_:-]{1,96}$/.test(rotationKey)) issues.push({ code: 'invalid-context', path: 'rotationKey' });
  if (issues.length) return { ...report, status: 'failed', issues };
  add('policy', 'pass', 'valid');
  if (!provider) {
    add('provider', 'skipped', 'live-read-not-requested');
    report.status = 'incomplete';
    return report;
  }
  if (typeof provider.id !== 'string' || typeof provider.cacheKey !== 'string' || !provider.cacheKey ||
    !Array.isArray(provider.capabilities) || typeof provider.categories !== 'function' || typeof provider.list !== 'function') {
    add('provider', 'fail', 'invalid-adapter'); report.status = 'failed'; return report;
  }
  const enabledSources = sources.filter((source) => (policy.sourceWeights?.[source] ?? 1) > 0);
  if (!enabledSources.some((source) => provider.capabilities.includes(source)) &&
    !(policy.allowOverallBest === true && provider.capabilities.includes('overall-best'))) {
    add('provider', 'fail', 'source-capability-mismatch'); report.status = 'failed'; return report;
  }
  let tree;
  try { tree = await provider.categories(); }
  catch (error) { add('categories', 'fail', affiliateDiagnosticFailure(error)); report.status = 'failed'; return report; }
  const flat = flattenAffiliateCategories(tree);
  add('categories', flat.length ? 'pass' : 'warn', flat.length ? 'available' : 'empty-taxonomy');
  report.mappings = Object.keys(policy.groups).map((id) => ({ group: id,
    categoryIds: resolveAffiliateCategories(tree, policy.groups, [id], policy.excludedCategoryIds),
  }));
  const relevant = [...new Set([...topics, ...policy.defaultGroups])];
  if (relevant.some((id) => !report.mappings.some((m) => m.group === id && m.categoryIds.length))) {
    add('mapping', 'warn', 'unmatched-or-excluded-category');
  } else add('mapping', 'pass', 'matched');
  let providerFailure;
  // The wrapper preserves the adapter's declared capabilities and freshness, but
  // forcibly replaces all link behavior. A diagnostic must never mint links.
  const catalog = createAffiliateCatalog({ policy, now, provider: {
    id: provider.id, cacheKey: provider.cacheKey, capabilities: provider.capabilities,
    cacheTtlMs: provider.cacheTtlMs, preview: true, categories: async () => tree,
    list: (input) => provider.list(input),
    issueLink: async () => { throw new Error('Diagnostic link issuance prohibited'); },
  }, onError: (event) => { providerFailure = event; } });
  const { offer } = await catalog.select({ topics, rotationKey });
  if (offer) {
    report.preview = { productId: offer.productId, title: offer.title, source: offer.source,
      reason: offer.reason, categoryId: offer.categoryId, expiresAt: offer.expiresAt, url: null };
    add('selection', 'pass', 'candidate-selected');
  } else add('selection', providerFailure ? 'fail' : 'warn', providerFailure ? 'provider-unavailable' : 'no-eligible-product');
  add('link', 'skipped', 'read-only-no-issuance');
  report.status = checks.some((c) => c.status === 'fail') ? 'failed' : checks.some((c) => c.status === 'warn') ? 'warning' : 'ready';
  return report;
}
