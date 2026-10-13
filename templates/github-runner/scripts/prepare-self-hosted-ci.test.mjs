import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ciDockerArgs, prepareSelfHostedCi } from './prepare-self-hosted-ci.mjs';

function fixture(inspectError = 'no builder found', limits = {}, driverOptions = 'default-load="true"') {
  const dir = mkdtempSync(join(tmpdir(), 'runner-ci-contract-'));
  const config = { repository: 'owner/example', builder: 'example-ci', workdir: join(dir, 'work') };
  mkdirSync(join(config.workdir, '_temp'), { recursive: true });
  const env = { RUNNER_ENVIRONMENT: 'self-hosted', GITHUB_REPOSITORY: config.repository,
    GITHUB_ENV: join(dir, 'env'), RUNNER_TEMP: `${config.workdir}/_temp` };
  const calls = [];
  const execute = (args) => {
    calls.push(args);
    if (args.length === 3 && args[0] === 'buildx' && args[1] === 'inspect') {
      return inspectError ? { status: 1, stderr: inspectError } : { status: 0, stdout: `Driver: docker-container\nDriver Options: ${driverOptions}\n` };
    }
    return { status: 0, stdout: args[0] === 'inspect'
      ? JSON.stringify({ Memory: 8 * 1024 ** 3, MemorySwap: 8 * 1024 ** 3, CpuQuota: 400000, CpuPeriod: 100000, ...limits }) : '' };
  };
  return { config, dir, env, calls, execute, close: () => rmSync(dir, { recursive: true, force: true }) };
}
test('prepares an explicitly bounded builder and host-visible temporary files without changing global selection', () => {
  const f = fixture();
  try {
    prepareSelfHostedCi(f.config, f.env, f.execute);
    assert(f.calls.some(args => args.includes('default-load=true,memory=8g,memory-swap=8g,cpu-quota=400000,cpu-period=100000')));
    assert(!f.calls.some(args => args.includes('--use')));
    assert.ok(readFileSync(f.env.GITHUB_ENV, 'utf8').includes(`TMPDIR=${f.env.RUNNER_TEMP}\n`));
  } finally { f.close(); }
});
test('reuses a builder only after checking its actual resource limits', () => {
  const f = fixture(null); try { prepareSelfHostedCi(f.config, f.env, f.execute); assert(!f.calls.some(args => args.includes('create'))); } finally { f.close(); }
  const bad = fixture(null, { CpuQuota: 0 }); try { assert.throws(() => prepareSelfHostedCi(bad.config, bad.env, bad.execute)); } finally { bad.close(); }
});
test('a daemon failure cannot trigger builder creation', () => {
  const f = fixture('Cannot connect to Docker daemon');
  try { assert.throws(() => prepareSelfHostedCi(f.config, f.env, f.execute)); assert.equal(f.calls.length, 1); } finally { f.close(); }
});
test('rejects hosted jobs, another repository, and unshared temporary paths before Docker access', () => {
  const f = fixture();
  try {
    for (const patch of [{ RUNNER_ENVIRONMENT: 'github-hosted' }, { GITHUB_REPOSITORY: 'other/repo' }, { RUNNER_TEMP: '/tmp' }]) {
      assert.throws(() => prepareSelfHostedCi(f.config, { ...f.env, ...patch }, f.execute));
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

test('rejects traversal and symlinks outside the shared work directory', () => {
  const f = fixture();
  try {
    mkdirSync(join(f.dir, 'outside'));
    symlinkSync(join(f.dir, 'outside'), join(f.config.workdir, 'escape'));
    for (const path of [`${f.config.workdir}/../outside`, join(f.config.workdir, 'escape'), `${f.env.RUNNER_TEMP}\nINJECT=value`]) {
      assert.throws(() => prepareSelfHostedCi(f.config, { ...f.env, RUNNER_TEMP: path }, f.execute));
    }
    assert.equal(f.calls.length, 0);
  } finally { f.close(); }
});
test('rejects builders whose images would not load into the Docker daemon', () => {
  for (const options of ['', 'default-load="false"', 'memory="8g"']) {
    const f = fixture(null, {}, options);
    try {
      assert.throws(() => prepareSelfHostedCi(f.config, f.env, f.execute), /default-load=true/);
      assert.equal(f.calls.length, 1);
    } finally { f.close(); }
  }
});
test('rejects flags that could override fixture resource caps', () => {
  for (const flags of [['--cpus', '8'], ['--cpus=8'], ['--cpu-quota=900000'], ['--cpu-period=10000'],
    ['--memory=16g'], ['-m', '16g'], ['-m16g'], ['--memory-swap=-1'], ['--pids-limit=-1']]) {
    assert.throws(() => ciDockerArgs(['run', ...flags, 'fixture'], { RUNNER_ENVIRONMENT: 'self-hosted' }), /must not override/);
  }
});
