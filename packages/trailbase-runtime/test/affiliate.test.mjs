import { describe, test, expect } from 'bun:test';
import { createAffiliateCache } from '../src/affiliate/cache.mjs';
import { createAffiliateCatalog, resolveAffiliateCategories } from '../src/affiliate/selection.mjs';
import { createTossSharelinkProvider } from '../src/affiliate/toss-sharelink.mjs';
import { createAffiliateService } from '../src/affiliate/service.mjs';
import { chmod, mkdtemp, readdir, stat, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const NOW = Date.UTC(2026, 9, 2, 0);
const tree = [{ id: '1', name: '생활', children: [{ id: '2', name: '청소용품', children: [] }] },
  { id: '3', name: '식품', children: [] }];
const policy = { groups: { cleaning: { categoryNames: ['청소용품'] }, food: { categoryIds: ['3'] } },
  defaultGroups: ['food'], sourceWeights: { 'category-best': 1, 'today-deals': 1 } };
const product = (id, cats = ['1', '2'], extra = {}) => ({ id, title: id, soldOut: false, categoryIds: cats, ...extra });

test('private disk cache survives restart, expires and does not cache failed loaders', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'affiliate-cache-test-'));
  let clock = NOW;
  let loads = 0;
  try {
    const cache = createAffiliateCache({ directory, now: () => clock });
    const loader = async () => { loads++; return { token: 'synthetic-test' }; };
    await Promise.all([cache.load('oauth', 1000, loader), cache.load('oauth', 1000, loader)]);
    expect(loads).toBe(1);
    const restarted = createAffiliateCache({ directory, now: () => clock });
    expect(await restarted.get('oauth')).toEqual({ token: 'synthetic-test' });
    const files = await readdir(directory);
    expect(files).toHaveLength(1);
    expect((await stat(join(directory, files[0]))).mode & 0o777).toBe(0o600);
    clock += 1001;
    expect(await restarted.get('oauth')).toBeNull();
    await expect(cache.load('failure', 1000, async () => { throw new Error('offline'); })).rejects.toThrow('offline');
    expect(await cache.get('failure')).toBeNull();
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('disk pruning removes expired and excess entries', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'affiliate-prune-test-'));
  try {
    const cache = createAffiliateCache({ directory, maxEntries: 2, now: () => NOW });
    await cache.set('expired', 'old', NOW - 1);
    await cache.set('one', 'one', NOW + 1000);
    await cache.set('two', 'two', NOW + 1000);
    expect((await readdir(directory)).length).toBeLessThanOrEqual(2);
    await cache.set('three', 'three', NOW + 1000);
    await cache.set('four', 'four', NOW + 1000);
    expect((await readdir(directory)).length).toBeLessThanOrEqual(2);
    expect(await cache.get('four')).toBe('four');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('corrupt cache files are removed and unreadable directory scans do not fail a successful write', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'affiliate-housekeeping-test-'));
  try {
    const corrupt = `${'a'.repeat(64)}.json`;
    await writeFile(join(directory, corrupt), 'not JSON');
    const cache = createAffiliateCache({ directory, maxEntries: 1, now: () => NOW });
    await cache.set('valid', 'retained', NOW + 1000);
    expect(await readdir(directory)).not.toContain(corrupt);
    // A writable/searchable directory can still forbid directory enumeration.
    // This reproduces housekeeping EACCES without mocking provider requests.
    await chmod(directory, 0o300);
    if (process.getuid?.() !== 0) await expect(readdir(directory)).rejects.toMatchObject({ code: 'EACCES' });
    expect(await cache.set('new', 'successful', NOW + 1000)).toBe('successful');
    expect(await cache.get('new')).toBe('successful');
  } finally { await chmod(directory, 0o700); await rm(directory, { recursive: true, force: true }); }
});

test('native timeout/network errors are sanitized and pause direct adapter retries', async () => {
  for (const cause of [new DOMException('private upstream URL', 'TimeoutError'), Object.assign(new Error('secret network detail'), { code: 'ECONNRESET' })]) {
    let calls = 0;
    const provider = createTossSharelinkProvider({ accessKey: 'test', secretKey: 'test', publisherId: 'test',
      now: () => NOW, sleep: async () => {}, fetch: async () => { calls++; throw cause; } });
    await expect(provider.categories()).rejects.toThrow('Sharelink transport');
    await expect(provider.categories()).rejects.toThrow('Sharelink cooldown');
    expect(calls).toBe(1);
  }
});

test('invalid OAuth bodies pause direct retries and diagnostics expose only static fields', async () => {
  let calls = 0;
  const provider = createTossSharelinkProvider({ accessKey: 'test', secretKey: 'test', publisherId: 'test',
    now: () => NOW, sleep: async () => {}, fetch: async () => { calls++; return Response.json({ access_token: 'bad', expires_in: 1 }); } });
  await expect(provider.categories()).rejects.toThrow('invalid-token');
  await expect(provider.categories()).rejects.toThrow('cooldown');
  expect(calls).toBe(1);
  const events = [];
  const catalog = createAffiliateCatalog({ provider, policy, now: () => NOW, onError: async (event) => { events.push(event); throw new Error('sink failed'); } });
  expect((await catalog.select()).offer).toBeNull();
  expect(events).toEqual([{ code: 'selection-failed', stage: 'categories', retryAt: NOW + 60_000 }]);
});
function fixture(overrides = {}, customPolicy = policy) {
  const calls = [];
  const provider = { id: 'test-provider', cacheKey: 'account', capabilities: ['category-best', 'today-deals', 'overall-best'],
    cacheTtlMs: { 'category-best': 1000, 'today-deals': 1000, 'overall-best': 1000 },
    categories: async () => tree,
    list: async (request) => { calls.push(request); return request.source === 'category-best' ? [product(request.categoryId, [request.categoryId])] : []; },
    issueLink: async (id) => `https://affiliate.example/${id}`, ...overrides };
  return { calls, catalog: createAffiliateCatalog({ provider, policy: customPolicy, now: () => NOW }) };
}

describe('provider-neutral affiliate selection', () => {
  test('resolves nested categories and excludes an entire ancestor branch', () => {
    expect(resolveAffiliateCategories(tree, policy.groups, ['cleaning'])).toEqual(['2']);
    expect(resolveAffiliateCategories(tree, policy.groups, ['cleaning'], ['1'])).toEqual([]);
  });
  test('prefers related category; unknown topic uses configured default, never overall best', async () => {
    const { catalog, calls } = fixture();
    expect((await catalog.select({ topics: ['cleaning'], rotationKey: 'visit-1' })).offer.categoryId).toBe('2');
    expect((await catalog.select({ topics: ['unknown'], rotationKey: 'visit-2' })).offer.reason).toBe('default-category');
    expect(calls.some((call) => call.source === 'overall-best')).toBe(false);
  });
  test('both sources rotate across visits and stay stable within a visit', async () => {
    const { catalog } = fixture({ list: async ({ source }) => [product(source, ['2'], source === 'today-deals' ? { endAt: NOW + 900_000 } : {})] });
    const sources = new Set();
    for (let i = 0; i < 12; i++) {
      const input = { topics: ['cleaning'], rotationKey: `visit-${i}` };
      const first = await catalog.select(input);
      expect(await catalog.select(input)).toEqual(first);
      sources.add(first.offer.source);
    }
    expect([...sources].sort()).toEqual(['category-best', 'today-deals']);
  });
  test('filters unrelated deals, expired/sold-out/blocked/recent products', async () => {
    const { catalog } = fixture({ list: async () => [product('unrelated', ['3']), product('expired', ['2'], { endAt: NOW - 1 }),
      product('sold', ['2'], { soldOut: true }), product('blocked', ['2']), product('recent', ['2']),
      product('valid', ['2'], { endAt: NOW + 900_000 })] }, { ...policy, defaultGroups: [],
      blockedProductIds: ['blocked'], sourceWeights: { 'category-best': 0, 'today-deals': 1 } });
    expect((await catalog.select({ topics: ['cleaning'], excludeProductIds: ['recent'] })).offer.productId).toBe('valid');
  });
  test('empty/missing taxonomy returns no offer without silently requesting all best', async () => {
    const { catalog, calls } = fixture({ categories: async () => [] });
    expect((await catalog.select()).offer).toBeNull();
    expect(calls).toEqual([]);
  });
  test('a chosen parent category accepts a product tagged only with its descendant', async () => {
    for (const source of ['category-best', 'today-deals']) {
      const { catalog } = fixture({ list: async () => [product('leaf-only', ['2'], { endAt: NOW + 900_000 })] },
        { ...policy, groups: { cleaning: { categoryIds: ['1'] } }, defaultGroups: [],
          sourceWeights: { 'category-best': 0, 'today-deals': 0, [source]: 1 } });
      const result = await catalog.select({ topics: ['cleaning'] });
      expect(result.offer.productId).toBe('leaf-only');
      expect(result.offer.categoryId).toBe('1');
      expect(result.offer.source).toBe(source);
    }
  });
  test('unsupported source is skipped, overall best requires explicit opt-in', async () => {
    const { catalog, calls } = fixture({ capabilities: ['overall-best'], list: async (r) => { calls.push(r); return [product('best')]; } }, { ...policy, allowOverallBest: true });
    expect((await catalog.select()).offer.source).toBe('overall-best');
    expect(calls).toEqual([{ source: 'overall-best', categoryId: undefined }]);
  });
  test('provider failure cooldown prevents retries on every view', async () => {
    let attempts = 0;
    const { catalog } = fixture({ categories: async () => { attempts++; throw new Error('secret upstream body'); } });
    expect(await catalog.select()).toEqual({ offer: null, reason: 'provider-unavailable' });
    await catalog.select();
    expect(attempts).toBe(1);
  });
});

describe('Toss official wire contract', () => {
  function create(reply) {
    const calls = [];
    const cache = createAffiliateCache({ now: () => NOW });
    const provider = createTossSharelinkProvider({ accessKey: 'access', secretKey: 'secret', publisherId: 'publisher', subTagId: 'poll-maker',
      cache, now: () => NOW, sleep: async () => {}, fetch: async (url, init) => {
        calls.push({ url, init });
        return Response.json(url.includes('oauth2') ? { access_token: 'test-token', expires_in: 3600 } : reply(url, init));
      } });
    return { provider, calls };
  }
  test('OAuth encoding, typed product IDs, issued links reused; productUrl never published', async () => {
    const { provider, calls } = create((url) => url.endsWith('/links')
      ? { resultType: 'SUCCESS', success: { tacaItemId: 123, publisherId: 'publisher', shortUrl: 'https://toss.im/_m/test-only' } }
      : { resultType: 'SUCCESS', success: { items: [{ tacaItemId: 123, displayName: '물건', categoryIds: [2], isSoldOut: false,
        productUrl: 'https://toss.shopping/untracked' }] } });
    const items = await provider.list({ source: 'category-best', categoryId: '2' });
    expect(items[0]).toEqual({ id: '123', title: '물건', categoryIds: ['2'], soldOut: false });
    const links = await Promise.all([provider.issueLink('123'), provider.issueLink('123')]);
    expect(links).toEqual(['https://toss.im/_m/test-only', 'https://toss.im/_m/test-only']);
    expect(calls.filter((call) => call.url.endsWith('/links'))).toHaveLength(1);
    expect(calls.filter((call) => call.url.includes('oauth2'))).toHaveLength(1);
    expect(new URLSearchParams(calls[0].init.body).get('scope')).toBe('sharelink:read sharelink:write');
    expect(JSON.parse(calls.at(-1).init.body)).toEqual({ tacaItemId: 123, publisherId: 'publisher', subTagId: 'poll-maker' });
  });
  test('HTTP 200 FAIL is rejected and quotas pause further provider calls', async () => {
    const { provider, calls } = create(() => ({ resultType: 'FAIL', error: { errorCode: 'SHARELINK_OPENAPI_QUOTA_EXCEEDED' } }));
    await expect(provider.list({ source: 'today-deals' })).rejects.toThrow('quota-exceeded');
    await expect(provider.list({ source: 'today-deals' })).rejects.toThrow('cooldown');
    expect(calls).toHaveLength(2);
  });
  test('HTTP 200 access-denied has a sanitized diagnostic class', async () => {
    const { provider } = create(() => ({ resultType: 'FAIL', error: { errorCode: 'SHARELINK_OPENAPI_ACCESS_DENIED' } }));
    await expect(provider.list({ source: 'today-deals' })).rejects.toThrow('access-denied');
  });
  test('rejects wrong product/account echo and unsafe link hosts', async () => {
    for (const result of [{ tacaItemId: 999, publisherId: 'publisher', shortUrl: 'https://toss.im/test' },
      { tacaItemId: 123, publisherId: 'another', shortUrl: 'https://toss.im/test' },
      { tacaItemId: 123, publisherId: 'publisher', shortUrl: 'https://toss.im.evil.test/test' }]) {
      const { provider } = create(() => ({ resultType: 'SUCCESS', success: result }));
      await expect(provider.issueLink('123')).rejects.toThrow('invalid-link');
    }
  });
  test('no-code issuance failure is an unavailable item, not a successful link', async () => {
    const { provider } = create(() => ({ resultType: 'FAIL', error: { reason: 'changed upstream wording' } }));
    expect(await provider.issueLink('123')).toBeNull();
  });
});

test('private service refuses unauthenticated/oversize/arbitrary URL contexts', async () => {
  const token = 'local-test-token-long-enough';
  let calls = 0;
  const handler = createAffiliateService({ enabled: true, token, catalog: { select: async () => { calls++; return { offer: null }; } } });
  expect((await handler(new Request('http://internal/select', { method: 'POST' }))).status).toBe(401);
  const send = (body) => handler(new Request('http://internal/select', { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(body) }));
  expect((await send({ topics: ['http://attacker'], rotationKey: 'visit' })).status).toBe(400);
  expect((await send(null)).status).toBe(400);
  expect((await handler(new Request('http://internal/select', { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: '{' }))).status).toBe(400);
  expect((await send({ topics: [], rotationKey: 'x'.repeat(5000) })).status).toBe(413);
  expect((await send({ topics: ['cleaning'], rotationKey: 'visit-1' })).status).toBe(200);
  expect(calls).toBe(1);
});
