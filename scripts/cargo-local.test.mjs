import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cargoInvocation } from './cargo-local.mjs';
const host = { home: '/home/test', platform: 'darwin', arch: 'arm64' };
test('default cache and lightweight dev profiles; release remains unchanged', () => {
  const result = cargoInvocation(['--', 'build', '--release'], {}, host);
  assert.equal(result.env.CARGO_TARGET_DIR, '/home/test/.cache/ait-kit/cargo-target/Darwin-arm64');
  assert.equal(result.env.CARGO_PROFILE_DEV_DEBUG, 'line-tables-only');
  assert.equal(result.env.CARGO_PROFILE_TEST_DEBUG, 'line-tables-only');
  assert.equal(result.env.CARGO_PROFILE_RELEASE_DEBUG, undefined);
  assert.equal(result.env.CARGO_INCREMENTAL, undefined);
  assert.deepEqual(result.args, ['build', '--release']);
});
test('preserves explicit settings and Cargo CLI target override', () => {
  const env = { CARGO_TARGET_DIR: '/custom', CARGO_PROFILE_DEV_DEBUG: '2', CARGO_INCREMENTAL: '1' };
  const result = cargoInvocation(['--ephemeral', '--', 'check', '--target-dir', '/cli'], env, host);
  assert.equal(result.env.CARGO_TARGET_DIR, '/custom');
  assert.equal(result.env.CARGO_PROFILE_DEV_DEBUG, '2');
  assert.equal(result.env.CARGO_INCREMENTAL, '1');
  assert.equal(env.CARGO_PROFILE_TEST_DEBUG, undefined);
  assert.deepEqual(result.args, ['check', '--target-dir', '/cli']);
});
test('ephemeral and full debug modes', () => {
  const { env } = cargoInvocation(['--ephemeral', '--full-debug', '--', 'test'], {}, host);
  assert.equal(env.CARGO_INCREMENTAL, '0');
  assert.equal(env.CARGO_PROFILE_DEV_DEBUG, undefined);
  assert.equal(env.CARGO_PROFILE_TEST_DEBUG, undefined);
});
test('rejects unsafe defaults and ambiguous options', () => {
  assert.throws(() => cargoInvocation(['check'], { XDG_CACHE_HOME: 'relative' }, host), /absolute/);
  assert.throws(() => cargoInvocation(['clean'], {}, host), /inspected/);
  assert.throws(() => cargoInvocation(['+nightly', 'clean'], {}, host), /inspected/);
  assert.throws(() => cargoInvocation(['--oops', 'test'], {}, host), /Unknown/);
  assert.throws(() => cargoInvocation([], {}, host), /Usage/);
});

test('CLI uses consumer cwd, forwards failures and resolves metadata artifact paths', async () => {
  const { mkdtempSync, writeFileSync, chmodSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const path = await import('node:path');
  const { spawnSync } = await import('node:child_process');
  const root = mkdtempSync(path.join(tmpdir(), 'cargo-runner-test-'));
  const runner = new URL('./cargo-local.mjs', import.meta.url);
  try {
    const fake = path.join(root, 'cargo');
    writeFileSync(fake, `#!/usr/bin/env node\nif(process.argv[2]==='metadata') console.log(JSON.stringify({target_directory:process.env.CARGO_TARGET_DIR})); else { console.log(JSON.stringify({cwd:process.cwd(),args:process.argv.slice(2)})); process.exitCode=17; }\n`);
    chmodSync(fake, 0o755);
    const env = { ...process.env, PATH: root + path.delimiter + process.env.PATH, CARGO_TARGET_DIR: path.join(root,'target with spaces') };
    const meta = spawnSync(process.execPath, [runner.pathname, '--', 'target-dir'], { cwd: root, env, encoding: 'utf8' });
    assert.equal(meta.status, 0, meta.stderr);
    assert.equal(meta.stdout.trim(), env.CARGO_TARGET_DIR);
    const override = spawnSync(process.execPath, [runner.pathname, '--', 'target-dir', '--target-dir', 'cli-target'], { cwd: root, env, encoding: 'utf8' });
    assert.equal(override.status, 0, override.stderr);
    assert.ok(override.stdout.trim().endsWith('/cli-target'));
    const build = spawnSync(process.execPath, [runner.pathname, '--', 'check', '--manifest-path', 'a b/Cargo.toml'], { cwd: root, env, encoding: 'utf8' });
    assert.equal(build.status, 17);
    const result = JSON.parse(build.stdout);
    // macOS may canonicalize /tmp to /private/tmp.
    assert.ok(result.cwd.endsWith(path.basename(root)));
    assert.deepEqual(result.args, ['check','--manifest-path','a b/Cargo.toml']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
