import { timingSafeEqual } from 'node:crypto';

/** Private HTTP boundary; consumers authenticate users and derive topic IDs before
 * calling it. Never expose the provider credentials or accept a target URL. */
export function createAffiliateService({ catalog, token, enabled = false, maxConcurrent = 4 }) {
  if (typeof token !== 'string' || token.length < 24) throw new Error('Affiliate internal token must have at least 24 characters');
  const credential = Buffer.from(`Bearer ${token}`);
  let active = 0;
  return async function handle(request) {
    const response = (body, status = 200) => Response.json(body, {
      status, headers: { 'cache-control': 'no-store' },
    });
    if (new URL(request.url).pathname === '/health' && request.method === 'GET') {
      return response({ status: 'ok', enabled, protocol: 'affiliate-catalog-v1' });
    }
    const supplied = Buffer.from(request.headers.get('authorization') ?? '');
    if (supplied.length !== credential.length || !timingSafeEqual(supplied, credential)) return response({ error: 'unauthorized' }, 401);
    if (new URL(request.url).pathname !== '/select' || request.method !== 'POST') return response({ error: 'not-found' }, 404);
    if (!enabled) return response({ offer: null, reason: 'disabled' });
    if (active >= maxConcurrent) return response({ offer: null, reason: 'busy' }, 503);
    active++;
    try {
      if (Number(request.headers.get('content-length')) > 4096) return response({ error: 'body-too-large' }, 413);
      const reader = request.body?.getReader();
      if (!reader) return response({ error: 'invalid-context' }, 400);
      let size = 0;
      const chunks = [];
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 4096) { await reader.cancel(); return response({ error: 'body-too-large' }, 413); }
        chunks.push(value);
      }
      let input;
      try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { return response({ error: 'invalid-context' }, 400); }
      if (!input || typeof input !== 'object' || !Array.isArray(input.topics) || input.topics.length > 6 ||
        !input.topics.every((topic) => typeof topic === 'string' && /^[a-z0-9-]{1,40}$/.test(topic)) ||
        typeof input.rotationKey !== 'string' || !/^[a-zA-Z0-9_:-]{1,96}$/.test(input.rotationKey) ||
        !Array.isArray(input.excludeProductIds ?? []) || (input.excludeProductIds?.length ?? 0) > 30 ||
        !(input.excludeProductIds ?? []).every((id) => typeof id === 'string' && id.length <= 80)) {
        return response({ error: 'invalid-context' }, 400);
      }
      return response(await catalog.select(input));
    } catch { return response({ offer: null, reason: 'unavailable' }); }
    finally { active--; }
  };
}
