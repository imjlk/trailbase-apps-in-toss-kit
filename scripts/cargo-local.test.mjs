import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { cargoInvocation, metadataInvocation } from './cargo-local.mjs';
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
    writeFileSync(fake, `#!${process.execPath}\nif(process.argv[2]==='metadata') console.log(JSON.stringify({target_directory:process.env.CARGO_TARGET_DIR})); else { console.log(JSON.stringify({cwd:process.cwd(),args:process.argv.slice(2)})); process.exitCode=17; }\n`);
    chmodSync(fake, 0o755);
    const env = { ...process.env, PATH: root + path.delimiter + process.env.PATH, CARGO_TARGET_DIR: path.join(root,'target with spaces') };
    const meta = spawnSync(process.execPath, [fileURLToPath(runner), '--', 'target-dir'], { cwd: root, env, encoding: 'utf8' });
    assert.equal(meta.status, 0, meta.stderr);
    assert.equal(meta.stdout.trim(), env.CARGO_TARGET_DIR);
    const override = spawnSync(process.execPath, [fileURLToPath(runner), '--', 'target-dir', '--target-dir', 'cli-target'], { cwd: root, env, encoding: 'utf8' });
    assert.equal(override.status, 0, override.stderr);
    assert.ok(override.stdout.trim().endsWith('/cli-target'));
    const build = spawnSync(process.execPath, [fileURLToPath(runner), '--', 'check', '--manifest-path', 'a b/Cargo.toml'], { cwd: root, env, encoding: 'utf8' });
    assert.equal(build.status, 17);
    const result = JSON.parse(build.stdout);
    // macOS may canonicalize /tmp to /private/tmp.
    assert.ok(result.cwd.endsWith(path.basename(root)));
    assert.deepEqual(result.args, ['check','--manifest-path','a b/Cargo.toml']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('Cargo global options cannot bypass the clean guard', () => {
  for (const prefix of [['--offline'], ['--locked'], ['--config', 'net.offline=true'], ['+nightly', '--config=net.offline=true'], ['-vv', '--color', 'never']]) {
    assert.throws(() => cargoInvocation(['--', ...prefix, 'clean'], {}, host), /inspected/);
    assert.equal(cargoInvocation(['--', ...prefix, 'check'], {}, host).args.at(-1), 'check');
  }
  assert.throws(() => cargoInvocation(['--', '--unknown', 'value', 'clean'], {}, host), /Unsupported/);
});
test('Linux ARM cache matches uname and both Cargo target environment variables are respected', () => {
  assert.equal(cargoInvocation(['check'], {}, { ...host, platform: 'linux' }).env.CARGO_TARGET_DIR, '/home/test/.cache/ait-kit/cargo-target/Linux-aarch64');
  const env = { CARGO_BUILD_TARGET_DIR: '/alternate' };
  assert.equal(cargoInvocation(['check'], env, host).env.CARGO_TARGET_DIR, undefined);
  assert.equal(cargoInvocation(['check'], env, host).env.CARGO_BUILD_TARGET_DIR, '/alternate');
});
test('artifact lookup accepts build selection and configuration without passing build-only flags to metadata', () => {
  const result = metadataInvocation(['--release', '--target', 'wasm32-wasip2', '--profile=release', '--example', 'smoke', '--jobs', '2', '--manifest-path', 'path with spaces/Cargo.toml', '--config', 'net.offline=true', '--locked', '--target-dir', '/cli'], {});
  assert.deepEqual(result.args, ['metadata', '--format-version', '1', '--no-deps', '--filter-platform', 'wasm32-wasip2', '--manifest-path', 'path with spaces/Cargo.toml', '--config', 'net.offline=true', '--locked']);
  assert.equal(result.env.CARGO_TARGET_DIR, '/cli');
  assert.throws(() => metadataInvocation(['--target-dir'], {}), /requires/);
  assert.throws(() => metadataInvocation(['--surprise'], {}), /Unsupported/);
});
test('CLI runs from a checkout path containing spaces and non-ASCII characters', async () => {
  const { mkdtempSync, copyFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const path = await import('node:path');
  const { spawnSync } = await import('node:child_process');
  const root = mkdtempSync(path.join(tmpdir(), 'cargo 한글 checkout '));
  try {
    const runner = path.join(root, 'cargo-local.mjs');
    copyFileSync(fileURLToPath(new URL('./cargo-local.mjs', import.meta.url)), runner);
    const result = spawnSync(process.execPath, [runner, '--', '--offline', 'clean'], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /inspected/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
for (const command of ['check', 'target-dir']) test(`parent timeout terminates ${command} and its stubborn descendant`, { skip: process.platform === 'win32' }, async () => {
  const { mkdtempSync, writeFileSync, readFileSync, chmodSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const path = await import('node:path');
  const { spawnSync } = await import('node:child_process');
  const root = mkdtempSync(path.join(tmpdir(), 'cargo-signal-'));
  try {
    const heartbeat = path.join(root, 'heartbeat');
    const worker = path.join(root, 'worker.cjs');
    writeFileSync(worker, `const fs=require('node:fs'); process.on('SIGTERM',()=>{}); setInterval(()=>fs.appendFileSync(process.env.HEARTBEAT,'x'),20);`);
    const fake = path.join(root, 'cargo');
    writeFileSync(fake, `#!${process.execPath}\nrequire('node:child_process').spawn(process.execPath,[${JSON.stringify(worker)}],{stdio:'inherit'}); process.on('SIGTERM',()=>{}); setInterval(()=>{},1000);`);
    chmodSync(fake, 0o755);
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('./cargo-local.mjs', import.meta.url)), '--', command], {
      env: { ...process.env, PATH: root + path.delimiter + process.env.PATH, HEARTBEAT: heartbeat }, timeout: 3000, encoding: 'utf8',
    });
    assert.equal(result.error?.code, 'ETIMEDOUT');
    const stopped = readFileSync(heartbeat, 'utf8');
    assert.ok(stopped.length > 0);
    await new Promise(resolve => setTimeout(resolve, 150));
    assert.equal(readFileSync(heartbeat, 'utf8'), stopped);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('explicit Cargo config retains Cargo directory selection without a wrapper override', () => {
  for (const args of [
    ['--config', 'build.target-dir="/explicit"', 'check'],
    ['check', '--config=build.target-dir="/explicit"'],
    ['target-dir', '--config', 'config with spaces.toml'],
  ]) {
    assert.equal(cargoInvocation(['--', ...args], {}, host).env.CARGO_TARGET_DIR, undefined);
  }
  const configured = cargoInvocation(['--', 'check', '--config', 'file.toml'], { CARGO_TARGET_DIR: '/environment' }, host);
  assert.equal(configured.env.CARGO_TARGET_DIR, '/environment');
  assert.equal(cargoInvocation(['--', 'run', '--', '--config', 'application.toml'], {}, host).env.CARGO_TARGET_DIR, '/home/test/.cache/ait-kit/cargo-target/Darwin-arm64');
});

test('rejects custom aliases, built-in alias abbreviations and external plugins before Cargo runs', () => {
  for (const command of ['wipe', 'b', 'c', 'd', 't', 'r', 'clippy', 'fmt']) {
    assert.throws(() => cargoInvocation(['--', command], { CARGO_ALIAS_WIPE: 'clean', CARGO_ALIAS_CLIPPY: 'clean' }, host), /Aliases and external/);
    assert.throws(() => cargoInvocation(['--', '--config', 'aliases.toml', command], {}, host), /Aliases and external/);
  }
  assert.equal(cargoInvocation(['--', 'check'], { CARGO_ALIAS_CHECK: 'clean' }, host).args[0], 'check');
});

test('native Windows is rejected before starting an unmanaged child tree', () => {
  assert.throws(() => cargoInvocation(['check'], {}, { ...host, platform: 'win32' }), /inside WSL/);
});

test('target-dir translates the pseudo-command while retaining toolchain and global config', async () => {
  const { mkdtempSync, writeFileSync, readFileSync, chmodSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const path = await import('node:path');
  const { spawnSync } = await import('node:child_process');
  const root = mkdtempSync(path.join(tmpdir(), 'cargo-selector-'));
  try {
    const fake = path.join(root, 'cargo');
    const captured = path.join(root, 'args.json');
    writeFileSync(fake, `#!${process.execPath}\nrequire('node:fs').writeFileSync(process.env.ARGS_FILE,JSON.stringify(process.argv.slice(2)));console.log(JSON.stringify({target_directory:process.env.CARGO_TARGET_DIR}));`);
    chmodSync(fake, 0o755);
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('./cargo-local.mjs', import.meta.url)), '--', '+fixture', '--config', 'alias.target-dir="clean"', 'target-dir', '--target', 'wasm32-wasip2', '--release'], {
      env: { ...process.env, PATH: root + path.delimiter + process.env.PATH, ARGS_FILE: captured, CARGO_TARGET_DIR: path.join(root,'target') }, encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(readFileSync(captured,'utf8')), ['+fixture', '--config', 'alias.target-dir="clean"', 'metadata', '--format-version', '1', '--no-deps', '--filter-platform', 'wasm32-wasip2']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('metadata capture is bounded and terminates an oversized producer', async () => {
  const { mkdtempSync, writeFileSync, chmodSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const path = await import('node:path');
  const { spawnSync } = await import('node:child_process');
  const root = mkdtempSync(path.join(tmpdir(), 'cargo-metadata-limit-'));
  try {
    const fake = path.join(root, 'cargo');
    writeFileSync(fake, `#!${process.execPath}\nprocess.stdout.write('x'.repeat(17*1024*1024));setInterval(()=>{},1000);`);
    chmodSync(fake, 0o755);
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('./cargo-local.mjs', import.meta.url)), '--', 'target-dir'], {
      env: { ...process.env, PATH: root + path.delimiter + process.env.PATH }, encoding: 'utf8', timeout: 10000,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /exceeded 16 MiB/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
