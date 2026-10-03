#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { homedir, platform, arch } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function cargoInvocation(argv, env = process.env, host = { home: homedir(), platform: platform(), arch: arch() }) {
  const args = [...argv];
  let ephemeral = false;
  let fullDebug = false;
  while (args[0]?.startsWith('--')) {
    if (args[0] === '--ephemeral') ephemeral = true;
    else if (args[0] === '--full-debug') fullDebug = true;
    else if (args[0] === '--') { args.shift(); break; }
    else throw new Error(`Unknown wrapper option: ${args[0]}`);
    args.shift();
  }
  if (!args.length) throw new Error('Usage: cargo-local.mjs [--ephemeral] [--full-debug] -- <cargo command> [args]');
  if ((args[0].startsWith('+') ? args[1] : args[0]) === 'clean') throw new Error('Shared caches must be inspected before cleaning. Use cargo clean explicitly outside this wrapper.');
  const next = { ...env };
  if (!next.CARGO_TARGET_DIR) {
    const base = next.XDG_CACHE_HOME || path.join(host.home, '.cache');
    if (!path.isAbsolute(base)) throw new Error('XDG_CACHE_HOME must be absolute');
    next.CARGO_TARGET_DIR = path.join(base, 'ait-kit', 'cargo-target', `${({ darwin: "Darwin", linux: "Linux", win32: "Windows_NT" })[host.platform] ?? host.platform}-${host.arch === "x64" ? "x86_64" : host.arch}`);
  }
  if (!fullDebug) {
    next.CARGO_PROFILE_DEV_DEBUG ??= 'line-tables-only';
    next.CARGO_PROFILE_TEST_DEBUG ??= 'line-tables-only';
  }
  if (ephemeral) next.CARGO_INCREMENTAL ??= '0';
  return { args, env: next };
}

export function main(argv = process.argv.slice(2)) {
  const invocation = cargoInvocation(argv);
  if (invocation.args[0] === 'target-dir') {
    const metadataArgs = invocation.args.slice(1);
    // metadata has no --target-dir flag; apply the same build CLI override as an environment value.
    const targetIndex = metadataArgs.findIndex((arg) => arg === '--target-dir' || arg.startsWith('--target-dir='));
    if (targetIndex >= 0) {
      const flag = metadataArgs[targetIndex];
      const value = flag === '--target-dir' ? metadataArgs[targetIndex + 1] : flag.slice('--target-dir='.length);
      if (!value || value.startsWith('--')) throw new Error('--target-dir requires a directory');
      invocation.env.CARGO_TARGET_DIR = path.resolve(value);
      metadataArgs.splice(targetIndex, flag === '--target-dir' ? 2 : 1);
    }
    const result = spawnSync('cargo', ['metadata', '--format-version', '1', '--no-deps', ...metadataArgs], {
      env: invocation.env, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(result.stderr || 'Cargo metadata failed');
    const target = JSON.parse(result.stdout).target_directory;
    if (typeof target !== 'string' || !path.isAbsolute(target)) throw new Error('Cargo metadata returned an invalid target directory');
    console.log(target);
    return 0;
  }
  // Run in the consumer's cwd: its rust-toolchain/config and manifest remain authoritative.
  const result = spawnSync('cargo', invocation.args, { env: invocation.env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.signal) throw new Error(`Cargo terminated by ${result.signal}`);
  return result.status ?? 1;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = main(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
