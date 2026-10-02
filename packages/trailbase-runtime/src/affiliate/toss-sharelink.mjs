import { createHash } from 'node:crypto';
import { createAffiliateCache } from './cache.mjs';

const BASE = 'https://sharelink.toss.im/openapi';
const TOKEN_URL = 'https://oauth2.cert.toss.im/token';
const HOUR = 3_600_000;
const validId = (value) => Number.isSafeInteger(Number(value)) && Number(value) > 0;
const linkUrl = (value) => typeof value === 'string' && value.length <= 4096 &&
  !/[\s\\\u0000-\u001f\u007f]/u.test(value) && /^https:\/\/(?:toss\.im|toss\.shopping)(?:[/?#]|$)/i.test(value) ? value : null;
function failure(code, retryAt = 0) {
  const error = new Error(`Sharelink ${code}`);
  error.code = code;
  error.retryAt = retryAt;
  return error;
}
function nextKstDay(now) { return Math.floor((now + 9 * HOUR) / (24 * HOUR) + 1) * 24 * HOUR - 9 * HOUR; }

/** Server-only. Fixed official endpoints, OAuth client_credentials (not mTLS).
 * Inject fetch/cache for tests; never place these keys in a native/web bundle. */
export function createTossSharelinkProvider({ accessKey, secretKey, publisherId, subTagId,
  cache = createAffiliateCache(), fetch: transport = globalThis.fetch, now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) }) {
  if (![accessKey, secretKey, publisherId].every((value) => typeof value === 'string' && value.trim())) {
    throw new Error('Sharelink access key, secret key and publisher ID are required');
  }
  const account = createHash('sha256').update(JSON.stringify([accessKey, secretKey, publisherId, subTagId ?? ''])).digest('hex');
  const prefix = `toss-sharelink:${account}:`;
  let queue = Promise.resolve();
  let nextCall = 0;
  let unavailableUntil = 0;
  async function request(url, init) {
    if (unavailableUntil > now()) throw failure('cooldown', unavailableUntil);
    const previous = queue;
    let unlock;
    queue = new Promise((resolve) => { unlock = resolve; });
    await previous;
    try {
      if (unavailableUntil > now()) throw failure('cooldown', unavailableUntil);
      await sleep(Math.max(0, nextCall - now()));
      nextCall = now() + 250;
      const response = await transport(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(5000) });
      if (!response.ok) {
        if (response.status === 401 && url.startsWith(BASE)) {
          await cache.set(`${prefix}oauth`, null, 0);
        }
        const retry = Number(response.headers.get('retry-after'));
        unavailableUntil = now() + (response.status === 429 && Number.isFinite(retry) && retry > 0 ? Math.min(retry, 86400) * 1000 : 60_000);
        throw failure(`http-${response.status}`, unavailableUntil);
      }
      const declared = Number(response.headers.get('content-length'));
      if (declared > 1_048_576) throw failure('response-too-large');
      const reader = response.body.getReader();
      const chunks = [];
      let size = 0;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 1_048_576) { await reader.cancel(); throw failure('response-too-large'); }
        chunks.push(value);
      }
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch (error) {
      if (error.code) throw error;
      unavailableUntil = now() + 60_000;
      // Do not propagate provider bodies, URLs or native network errors.
      throw failure('transport', unavailableUntil);
    } finally { unlock(); }
  }
  async function token() {
    const key = `${prefix}oauth`;
    const cached = await cache.get(key);
    if (cached?.value && cached.expiresAt > now()) return cached.value;
    return cache.load(`${prefix}token-flight`, 1, async () => {
      const response = await request(TOKEN_URL, {
        method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'client_credentials', client_id: accessKey,
          client_secret: secretKey, scope: 'sharelink:read sharelink:write' }).toString(),
      });
      if (typeof response.access_token !== 'string' || !response.access_token ||
        !Number.isFinite(response.expires_in) || response.expires_in <= 60) throw failure('invalid-token');
      const expiresAt = now() + (response.expires_in - 60) * 1000;
      await cache.set(key, { value: response.access_token, expiresAt }, expiresAt);
      return response.access_token;
    });
  }
  async function api(path, body) {
    const bearer = await token();
    const response = await request(`${BASE}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (response.resultType !== 'SUCCESS' || !response.success) {
      const code = response.error?.errorCode;
      if (path === '/links' && response.resultType === 'FAIL' && !code) throw failure('item-unavailable');
      unavailableUntil = code === 'SHARELINK_OPENAPI_QUOTA_EXCEEDED' ? nextKstDay(now()) : now() + 60_000;
      throw failure('provider-rejected', unavailableUntil);
    }
    return response.success;
  }
  function normalizeProduct(item) {
    if (!validId(item?.tacaItemId) || typeof item.displayName !== 'string' || !item.displayName.trim() ||
      typeof item.isSoldOut !== 'boolean' || !Array.isArray(item.categoryIds)) return null;
    return { id: String(item.tacaItemId), title: item.displayName.slice(0, 180),
      categoryIds: item.categoryIds.filter(validId).map(String), soldOut: item.isSoldOut,
      ...(item.endAt ? { endAt: Date.parse(item.endAt) } : {}) };
  }
  return {
    id: 'toss-shopping', cacheKey: account,
    capabilities: ['category-best', 'today-deals', 'overall-best'],
    cacheTtlMs: { 'category-best': 24 * HOUR, 'today-deals': 15 * 60_000, 'overall-best': HOUR },
    async categories() {
      const data = await api('/categories');
      function normalize(nodes, depth = 0) {
        if (!Array.isArray(nodes) || depth > 5) return [];
        return nodes.filter((node) => validId(node.categoryId) && typeof node.displayName === 'string')
          .map((node) => ({ id: String(node.categoryId), name: node.displayName,
            children: normalize(node.children, depth + 1) }));
      }
      return normalize(data.categories);
    },
    async list({ source, categoryId }) {
      let path;
      if (source === 'category-best' && validId(categoryId)) path = `/products/best-categories/${categoryId}?size=30`;
      else if (source === 'today-deals') path = '/products/today-deals?size=30';
      else if (source === 'overall-best') path = '/products/best-selling?size=30';
      else throw failure('unsupported-source');
      const data = await api(path);
      if (!Array.isArray(data.items)) throw failure('invalid-products');
      return data.items.map(normalizeProduct).filter(Boolean);
    },
    async issueLink(productId) {
      if (!validId(productId)) throw failure('invalid-product-id');
      const key = `${prefix}link:${productId}`;
      const result = await cache.load(key, 15 * 60_000, async () => {
        let data;
        try { data = await api('/links', { tacaItemId: Number(productId), publisherId,
          ...(subTagId ? { subTagId } : {}) }); } catch (error) {
          if (error.code === 'item-unavailable') return { url: null };
          throw error;
        }
        const url = linkUrl(data.shortUrl) ?? linkUrl(data.originUrl);
        if (String(data.tacaItemId) !== productId || data.publisherId !== publisherId || !url) throw failure('invalid-link');
        return { url };
      });
      if (result.url) await cache.set(key, result, now() + 30 * 24 * HOUR);
      return result.url;
    },
  };
}
