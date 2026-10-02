import { test, expect } from 'bun:test';
import { normalizeAppsInTossShoppingOffer } from '../src/shopping';
const offer = { provider: 'toss-shopping', productId: '123', title: '물건',
  source: 'category-best', reason: 'related', url: 'https://toss.im/_m/test-only', expiresAt: 200 };
test('validates provider, URL, expiry and text before rendering a server offer', () => {
  expect(normalizeAppsInTossShoppingOffer(offer, { now: 100 })?.title).toBe('물건');
  for (const patch of [{ provider: 'unknown' }, { url: 'https://toss.im.evil.test/' }, { expiresAt: 99 },
    { title: 'x'.repeat(181) }, { productId: '../secret' }, { source: 'invented' }]) {
    expect(normalizeAppsInTossShoppingOffer({ ...offer, ...patch }, { now: 100 })).toBeNull();
  }
});
test('preview offers cannot navigate and require explicit development opt-in', () => {
  const preview = { ...offer, preview: true, url: null };
  expect(normalizeAppsInTossShoppingOffer(preview, { now: 100 })).toBeNull();
  expect(normalizeAppsInTossShoppingOffer(preview, { now: 100, allowPreview: true })?.url).toBeNull();
  expect(normalizeAppsInTossShoppingOffer({ ...preview, url: offer.url }, { now: 100, allowPreview: true })).toBeNull();
});
