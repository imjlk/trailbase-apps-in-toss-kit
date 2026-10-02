import { createHash } from 'node:crypto';
import { createAffiliateCache } from './cache.mjs';

const HOUR = 3_600_000;
const names = (value) => String(value).normalize('NFKC').trim().toLowerCase();
const hash = (value) => createHash('sha256').update(value).digest().readUInt32BE(0);
const rotate = (items, seed) => {
  if (!items.length) return [];
  const offset = hash(seed) % items.length;
  return [...items.slice(offset), ...items.slice(0, offset)];
};

export function flattenAffiliateCategories(tree) {
  const result = [];
  function visit(nodes, ancestors = [], depth = 0) {
    if (depth > 8 || !Array.isArray(nodes)) return;
    for (const node of nodes.slice(0, 1000)) {
      if (!node || typeof node.name !== 'string' || typeof node.id !== 'string') continue;
      const path = [...ancestors, node.id];
      result.push({ id: node.id, name: node.name, path });
      visit(node.children, path, depth + 1);
    }
  }
  visit(tree);
  return result;
}

/** Provider-neutral policy. IDs belong to the adapter's taxonomy; group/topic
 * meaning belongs to the consumer. Missing category matches never mean all best. */
export function resolveAffiliateCategories(tree, groups, groupIds, excludedIds = []) {
  const categories = flattenAffiliateCategories(tree);
  const excluded = new Set(excludedIds);
  const selected = new Set();
  for (const id of groupIds) {
    const group = groups[id];
    if (!group) continue;
    const wantedIds = new Set(group.categoryIds ?? []);
    const wantedNames = new Set((group.categoryNames ?? []).map(names));
    for (const category of categories) {
      if (category.path.some((part) => excluded.has(part))) continue;
      if (wantedIds.has(category.id) || wantedNames.has(names(category.name))) selected.add(category.id);
    }
  }
  return [...selected];
}

export function createAffiliateCatalog({ provider, policy, cache = createAffiliateCache(), now = Date.now, onError }) {
  if (!provider?.cacheKey || !policy?.groups || !Array.isArray(policy.defaultGroups)) {
    throw new Error('Affiliate provider and category policy are required');
  }
  const prefix = `affiliate:${provider.cacheKey}:`;
  const excludedCategories = new Set(policy.excludedCategoryIds ?? []);
  const blockedProducts = new Set(policy.blockedProductIds ?? []);
  const sourceWeights = { 'category-best': 1, 'today-deals': 1, ...policy.sourceWeights };
  const sources = Object.keys(sourceWeights).filter((source) =>
    ['category-best', 'today-deals'].includes(source) && Number.isInteger(sourceWeights[source]) &&
    sourceWeights[source] > 0 && sourceWeights[source] <= 10 && provider.capabilities.includes(source));
  let cooldownUntil = 0;

  async function list(source, categoryId) {
    // Source-specific freshness belongs to the adapter. Selection always checks
    // sold-out/endAt again, even when a cached list has not yet expired.
    const configuredTtl = provider.cacheTtlMs?.[source];
    const ttl = Number.isFinite(configuredTtl) && configuredTtl > 0 ? configuredTtl : HOUR;
    return cache.load(`${prefix}${source}:${categoryId ?? ''}`, ttl,
      () => provider.list({ source, categoryId }));
  }
  async function select({ topics = [], rotationKey = 'default', excludeProductIds = [] } = {}) {
    if (cooldownUntil > now()) return { offer: null, reason: 'provider-unavailable' };
    const seed = String(rotationKey).slice(0, 96);
    const recent = new Set(excludeProductIds.slice(0, 30));
    let stage = 'categories';
    try {
      const tree = await cache.load(`${prefix}categories`, 24 * HOUR, () => provider.categories());
      const flat = flattenAffiliateCategories(tree);
      const forbiddenIds = new Set([...excludedCategories,
        ...flat.filter((category) => category.path.some((id) => excludedCategories.has(id))).map((category) => category.id)]);
      const related = resolveAffiliateCategories(tree, policy.groups,
        topics.filter((topic) => typeof topic === 'string').slice(0, 6), [...excludedCategories]);
      const defaults = resolveAffiliateCategories(tree, policy.groups, policy.defaultGroups, [...excludedCategories]);
      const groups = [
        { ids: related, reason: 'related' },
        { ids: defaults.filter((id) => !related.includes(id)), reason: 'default-category' },
      ];
      let linkAttempts = 0;
      const seen = new Set();
      async function offerFrom(items, source, categoryId, reason) {
        const eligible = items.filter((item) => item && !item.soldOut &&
          !blockedProducts.has(item.id) && !recent.has(item.id) && !seen.has(item.id) &&
          !item.categoryIds.some((id) => forbiddenIds.has(id)) &&
          (!categoryId || item.categoryIds.includes(categoryId)) &&
          (item.endAt === undefined || (Number.isFinite(item.endAt) && item.endAt > now() + 300_000)) &&
          (source !== 'today-deals' || (Number.isFinite(item.endAt) && item.endAt > now() + 300_000)));
        // Rotate within the top ten eligible candidates, not across an unbounded
        // catalogue. Same navigation key gives the same source/category/item.
        for (const item of rotate(eligible.slice(0, 10), `${seed}:${source}:${categoryId}`)) {
          if (linkAttempts >= 3) break;
          seen.add(item.id);
          linkAttempts++;
          let link;
          stage = 'link';
          try { link = provider.preview === true ? null : await provider.issueLink(item.id); } catch (error) {
            if (error.code === 'item-unavailable') continue;
            throw error;
          }
          if (!link && provider.preview !== true) continue;
          return { provider: provider.id, productId: item.id, title: item.title,
            url: link, preview: provider.preview === true, source, reason, categoryId: categoryId ?? null,
            expiresAt: Math.min(now() + 300_000, item.endAt ?? Infinity) };
        }
        return null;
      }
      const weighted = sources.flatMap((source) => Array(sourceWeights[source]).fill(source));
      const preferred = weighted.length ? weighted[hash(`${seed}:source`) % weighted.length] : null;
      const ordered = preferred ? [preferred, ...sources.filter((source) => source !== preferred)] : [];
      for (const group of groups) {
        for (const id of rotate(group.ids, `${seed}:category`).slice(0, 3)) {
          for (const source of ordered) {
            stage = 'list';
            const items = await list(source, source === 'category-best' ? id : undefined);
            const offer = await offerFrom(items, source, id, group.reason);
            if (offer) return { offer, reason: group.reason };
          }
        }
      }
      if (policy.allowOverallBest === true && provider.capabilities.includes('overall-best')) {
        stage = 'list';
        const offer = await offerFrom(await list('overall-best'), 'overall-best', null, 'overall-best');
        if (offer) return { offer, reason: 'overall-best' };
      }
      return { offer: null, reason: 'no-eligible-product' };
    } catch (error) {
      cooldownUntil = Math.max(now() + 60_000, Number.isFinite(error?.retryAt) ? error.retryAt : 0);
      // Static diagnostic only. Never give a logging sink raw provider/network
      // errors, product IDs, request context, tokens or URLs.
      try { Promise.resolve(onError?.({ code: 'selection-failed', stage, retryAt: cooldownUntil })).catch(() => {}); } catch { /* logging must not affect delivery */ }
      return { offer: null, reason: 'provider-unavailable' };
    }
  }
  return { select };
}
