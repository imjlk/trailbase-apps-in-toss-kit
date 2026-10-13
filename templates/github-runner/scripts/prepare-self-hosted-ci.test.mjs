import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ciDockerArgs, prepareSelfHostedCi } from './prepare-self-hosted-ci.mjs';

const config = { repository: 'owner/example', builder: 'example-ci', workdir: '/data/example/work' };
function fixture(inspectError = 'no builder found', limits = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'runner-ci-contract-'));
  const env = { RUNNER_ENVIRONMENT: 'self-hosted', GITHUB_REPOSITORY: config.repository,
    GITHUB_ENV: join(dir, 'env'), RUNNER_TEMP: `${config.workdir}/_temp` };
  const calls = [];
  const execute = (args) => {
    calls.push(args);
    if (args.length === 3 && args[0] === 'buildx' && args[1] === 'inspect') {
      return inspectError ? { status: 1, stderr: inspectError } : { status: 0, stdout: 'Driver: docker-container\n' };
    }
    return { status: 0, stdout: args[0] === 'inspect'
      ? JSON.stringify({ Memory: 8 * 1024 ** 3, MemorySwap: 8 * 1024 ** 3, CpuQuota: 400000, CpuPeriod: 100000, ...limits }) : '' };
  };
  return { env, calls, execute, close: () => rmSync(dir, { recursive: true, force: true }) };
}
test('prepares an explicitly bounded builder and host-visible temporary files without changing global selection', () => {
  const f = fixture();
  try {
    prepareSelfHostedCi(config, f.env, f.execute);
    assert(f.calls.some(args => args.includes('default-load=true,memory=8g,memory-swap=8g,cpu-quota=400000,cpu-period=100000')));
    assert(!f.calls.some(args => args.includes('--use')));
    assert.match(readFileSync(f.env.GITHUB_ENV, 'utf8'), /TMPDIR=\/data\/example\/work\/_temp/);
  } finally { f.close(); }
});
test('reuses a builder only after checking its actual resource limits', () => {
  const f = fixture(null); try { prepareSelfHostedCi(config, f.env, f.execute); assert(!f.calls.some(args => args.includes('create'))); } finally { f.close(); }
  const bad = fixture(null, { CpuQuota: 0 }); try { assert.throws(() => prepareSelfHostedCi(config, bad.env, bad.execute)); } finally { bad.close(); }
});
test('a daemon failure cannot trigger builder creation', () => {
  const f = fixture('Cannot connect to Docker daemon');
  try { assert.throws(() => prepareSelfHostedCi(config, f.env, f.execute)); assert.equal(f.calls.length, 1); } finally { f.close(); }
});
test('rejects hosted jobs, another repository, and unshared temporary paths before Docker access', () => {
  const f = fixture();
  try {
    for (const patch of [{ RUNNER_ENVIRONMENT: 'github-hosted' }, { GITHUB_REPOSITORY: 'other/repo' }, { RUNNER_TEMP: '/tmp' }]) {
      assert.throws(() => prepareSelfHostedCi(config, { ...f.env, ...patch }, f.execute));
    }
    assert.equal(f.calls.length, 0);
  } finally { f.close(); }
});
test('limits disposable containers only on self-hosted runners and preserves other Docker operations', () => {
  assert.deepEqual(ciDockerArgs(['run', '--rm', 'fixture'], {}), ['run', '--rm', 'fixture']);
  assert.deepEqual(ciDockerArgs(['inspect', 'fixture'], { RUNNER_ENVIRONMENT: 'self-hosted' }), ['inspect', 'fixture']);
  assert.deepEqual(ciDockerArgs(['run', '--rm', 'fixture'], { RUNNER_ENVIRONMENT: 'self-hosted' }),
    ['run', '--cpus', '2', '--memory', '4g', '--memory-swap', '4g', '--pids-limit', '512', '--rm', 'fixture']);
});
