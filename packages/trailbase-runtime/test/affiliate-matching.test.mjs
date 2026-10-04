import { describe, test, expect } from 'bun:test';
import { matchAffiliateProducts, issueAffiliateCandidateLink } from '../src/affiliate/matching.mjs';
const categories = [{ id: 'home', children: [{ id: 'bedding' }, { id: 'excluded', children: [{ id: 'child' }] }] }];
const product = (id, extra = {}) => ({ id, title: '편안한 베개', categoryIds: ['bedding'], soldOut: false, ...extra });
const match = (products, extra = {}) => matchAffiliateProducts({ products, categories, categoryId: 'home', keywords: ['베개'], now: 1000, ...extra });
const issue = (candidates, issueLink, extra = {}) => issueAffiliateCandidateLink({ candidates, issueLink,
  validateLink: url => url === 'https://example.test/issued', now: () => 1000, ...extra });
describe('affiliate product matching', () => {
  test('requires both lexical and descendant category matches, preserving order', () => {
    expect(match([product('a'), product('b', { title: '책상' }), product('c', { categoryIds: ['other'] }), product('d')]).map(p=>p.id)).toEqual(['a','d']);
    expect(match([product('a')], { categoryId: 'unknown' })).toEqual([]);
  });
  test('normalizes width, case and whitespace without inventing synonyms', () => {
    expect(match([product('a', { title: 'ＡＢ Ｃ 쿠션' })], { keywords: ['abc'] })).toHaveLength(1);
    expect(match([product('a')], { keywords: ['pillow'] })).toEqual([]);
  });
  test('exclusions beat positive matches, including excluded descendants', () => {
    expect(match([product('a'), product('b', { categoryIds: ['bedding','child'] }), product('c', { title: '베개 커버' })],
      { excludedProductIds: ['a'], excludedCategoryIds: ['excluded'], excludedKeywords: ['커버'] })).toEqual([]);
  });
  test('drops malformed, sold out, short lived and duplicate items', () => {
    expect(match([null, product('a', { soldOut: true }), product('b', { soldOut: undefined }), product('c', { endAt: 61000 }),
      product('d', { endAt: NaN }), product('e', { title: '베개\n' }), product('f'), product('f'), product('g')]).map(p=>p.id)).toEqual(['f','g']);
  });
  test('bounds candidates and rejects ambiguous or oversized taxonomy and rules', () => {
    expect(match([product('a'),product('b')], { limit: 1 })).toHaveLength(1);
    for (const extra of [{ keywords: [] }, { keywords: ['a'] }, { limit: 11 }, { categories: [{ id:'home',children:[{id:'home'}] }] },
      { products: Array(1001).fill(product('a')) }, { minValidityMs: -1 }]) expect(()=>match([],extra)).toThrow();
  });
});
describe('bounded affiliate link issuance', () => {
  test('null and explicit item-unavailable fall through to the next candidate', async () => {
    const calls=[];
    const result=await issue([product('a'),product('b'),product('c')], async id=>{
      calls.push(id); if(id==='a') return null; if(id==='b') throw Object.assign(Error('unavailable'),{code:'item-unavailable'});
      return 'https://example.test/issued';
    });
    expect(calls).toEqual(['a','b','c']); expect(result.product.id).toBe('c'); expect(result.attempts).toBe(3);
  });
  test.each(['auth','quota','transport'])('global %s error stops issuing', async code=>{
    const calls=[]; const error=Object.assign(Error('private upstream detail'),{code});
    await expect(issue([product('a'),product('b')], async id=>{calls.push(id);throw error;})).rejects.toBe(error);
    expect(calls).toEqual(['a']);
  });
  test('invalid links fail closed, never becoming an unavailable item', async()=>{
    let calls=0;
    await expect(issue([product('a'),product('b')],async()=>{calls++;return 'javascript:bad';})).rejects.toMatchObject({code:'invalid-link'});
    expect(calls).toBe(1);
  });
  test('attempt budget and duplicate filtering prevent repeated requests',async()=>{
    const calls=[];
    const result=await issue([product('a'),product('a'),product('b'),product('c')],async id=>{calls.push(id);return null;},{maxAttempts:2});
    expect(calls).toEqual(['a','b']);expect(result).toEqual({product:null,url:null,attempts:2});
  });
  test('rechecks validity after awaiting issuance',async()=>{
    let clock=1000;
    const result=await issue([product('a',{endAt:62000})],async()=>{clock=2000;return 'https://example.test/issued';},{now:()=>clock});
    expect(result.product).toBeNull();expect(result.attempts).toBe(1);
  });
});
