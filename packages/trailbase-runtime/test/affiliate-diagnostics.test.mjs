import { test, expect } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { diagnoseAffiliateCatalog, validateAffiliatePolicy, affiliateDiagnosticFailure } from '../src/affiliate/diagnostics.mjs';

const policy = { groups: { food: { categoryIds: ['1'] } }, defaultGroups: ['food'], sourceWeights: { 'category-best': 1, 'today-deals': 0 } };
const provider = () => ({ id: 'test', cacheKey: 'test', capabilities: ['category-best'], cacheTtlMs: { 'category-best': 1000 },
  categories: async () => [{ id: '1', name: '식품', children: [] }],
  list: async () => [{ id: 'test-product', title: '테스트 식품', categoryIds: ['1'], soldOut: false }],
  issueLink: async () => { throw new Error('Must never issue links in diagnostics'); },
});

test('offline validation identifies fields without exposing config values or making provider calls', async () => {
  expect((await diagnoseAffiliateCatalog({ policy })).status).toBe('incomplete');
  const invalid = await diagnoseAffiliateCatalog({ policy: { ...policy, sourceWeights: 'private-value' } });
  expect(invalid.status).toBe('failed');
  expect(JSON.stringify(invalid)).not.toContain('private-value');
  expect(validateAffiliatePolicy({ ...policy, sourceWeights: { 'category-best': 0, 'today-deals': 0 } })).toHaveLength(1);
  expect(validateAffiliatePolicy({ ...policy, defaultGroups: ['missing'] })).toHaveLength(1);
});

test('live-style preview uses the real selection policy but never issues or returns a link', async () => {
  let writes = 0;
  const adapter = { ...provider(), issueLink: async () => { writes++; return 'https://toss.im/private-tracking'; } };
  const result = await diagnoseAffiliateCatalog({ policy, provider: adapter, topics: ['food'] });
  expect(result.status).toBe('ready');
  expect(result.preview).toMatchObject({ title: '테스트 식품', reason: 'related', source: 'category-best', url: null });
  expect(result.linkIssuanceTested).toBe(false);
  expect(writes).toBe(0);
  expect(JSON.stringify(result)).not.toContain('private-tracking');
});

test('unmatched categories, no inventory and upstream errors remain distinct', async () => {
  const missing = await diagnoseAffiliateCatalog({ policy, provider: { ...provider(), categories: async () => [] } });
  expect(missing.checks).toContainEqual({ id: 'mapping', status: 'warn', code: 'unmatched-or-excluded-category' });
  const empty = await diagnoseAffiliateCatalog({ policy, provider: { ...provider(), list: async () => [] } });
  expect(empty.checks).toContainEqual({ id: 'selection', status: 'warn', code: 'no-eligible-product' });
  const rejected = await diagnoseAffiliateCatalog({ policy, provider: { ...provider(), categories: async () => {
    throw Object.assign(new Error('secret raw upstream body'), { code: 'access-denied' });
  } } });
  expect(rejected.status).toBe('failed');
  expect(rejected.checks).toContainEqual({ id: 'categories', status: 'fail', code: 'access-denied' });
  expect(JSON.stringify(rejected)).not.toContain('secret');
  expect(affiliateDiagnosticFailure({ code: 'a-secret' })).toBe('provider-unavailable');
});

test('CLI is offline by default; live mode requires credentials and never prints their values', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'affiliate-doctor-test-'));
  try {
    const path = join(directory, 'policy.json');
    await writeFile(path, JSON.stringify(policy));
    const executable = new URL('../bin/affiliate-doctor.mjs', import.meta.url).pathname;
    const env = { ...process.env, TOSS_SHOPPING_ACCESS_KEY: 'sensitive-synthetic-key', TOSS_SHOPPING_SECRET_KEY: '', TOSS_SHOPPING_PUBLISHER_ID: '' };
    const offline = spawnSync('node', [executable, '--policy', path], { env, encoding: 'utf8' });
    expect(offline.status).toBe(0);
    expect(JSON.parse(offline.stdout).mode).toBe('configuration');
    const live = spawnSync('node', [executable, '--policy', path, '--live'], { env, encoding: 'utf8' });
    expect(live.status).toBe(1);
    expect(JSON.parse(live.stdout).code).toBe('missing-server-credentials');
    expect(live.stdout + live.stderr).not.toContain('sensitive-synthetic-key');
    expect(spawnSync('node', [executable, '--arbitrary-url', 'https://invalid.test'], { env }).status).toBe(2);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
