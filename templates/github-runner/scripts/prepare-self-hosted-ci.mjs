import assert from 'node:assert/strict';
import { appendFileSync, readFileSync, realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export function ciDockerArgs(args, env = process.env) {
  if (env.RUNNER_ENVIRONMENT !== 'self-hosted' || args[0] !== 'run') return args;
  return ['run', '--cpus', '2', '--memory', '4g', '--memory-swap', '4g', '--pids-limit', '512', ...args.slice(1)];
}

export function prepareSelfHostedCi(config, env = process.env,
  execute = (args) => spawnSync('docker', args, { encoding: 'utf8', timeout: 120_000 })) {
  assert.equal(env.RUNNER_ENVIRONMENT, 'self-hosted', 'Self-hosted CI only');
  assert.equal(env.GITHUB_REPOSITORY, config.repository, 'Repository-scoped CI only');
  assert.match(config.builder, /^[a-z][a-z0-9-]+-ci$/);
  assert.ok(env.GITHUB_ENV, 'GitHub environment output is required');
  assert.ok(env.RUNNER_TEMP?.startsWith(`${config.workdir}/`), 'Temporary files must use the shared host/container work path');
  const run = (args) => {
    const result = execute(args);
    if (result.error || result.status !== 0) throw new Error(`Docker CI setup failed: ${result.error?.message ?? result.stderr}`);
    return result.stdout.trim();
  };
  const inspect = execute(['buildx', 'inspect', config.builder]);
  if (inspect.status !== 0) {
    assert.match(inspect.stderr ?? '', /no builder|not found|does not exist/i, 'Do not create a builder on an unreachable daemon');
    run(['buildx', 'create', '--name', config.builder, '--driver', 'docker-container', '--driver-opt',
      'default-load=true,memory=8g,memory-swap=8g,cpu-quota=400000,cpu-period=100000']);
  } else {
    assert.match(inspect.stdout, /^Driver:\s*docker-container\s*$/m, 'Unexpected builder driver');
  }
  run(['buildx', 'inspect', config.builder, '--bootstrap']);
  const limits = JSON.parse(run(['inspect', `buildx_buildkit_${config.builder}0`, '--format', '{{json .HostConfig}}']));
  assert.equal(limits.Memory, 8 * 1024 ** 3, 'Builder memory limit must be 8 GiB');
  assert.equal(limits.MemorySwap, limits.Memory, 'Builder swap is disabled');
  assert.equal(limits.CpuQuota, 400000, 'Builder CPU quota must be four cores');
  assert.equal(limits.CpuPeriod, 100000, 'Builder CPU period must match quota');
  appendFileSync(env.GITHUB_ENV, `BUILDX_BUILDER=${config.builder}\nDOCKER_BUILDKIT=1\nCARGO_BUILD_JOBS=2\nTMPDIR=${env.RUNNER_TEMP}\n`);
  return { builder: config.builder, cpus: 4, memoryGiB: 8 };
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  try {
    const config = JSON.parse(readFileSync(new URL('../ops/github-runner/config.json', import.meta.url), 'utf8'));
    console.log(JSON.stringify(prepareSelfHostedCi(config)));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
