#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { homedir, platform, arch } from 'node:os';
import path from 'node:path';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Parse only documented Cargo global options, never guess where an option value ends.
function cargoCommand(args) {
  let i = args[0]?.startsWith('+') ? 1 : 0;
  for (; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith('-')) return arg;
    if (/^(--offline|--locked|--frozen|--quiet|-q|-v+|--verbose)$/.test(arg)) continue;
    if (/^(--config|--color|--manifest-path|-C|-Z)$/.test(arg)) {
      if (!args[++i]) throw new Error(`${arg} requires a value`);
      continue;
    }
    if (/^(--config|--color|--manifest-path)=/.test(arg) || /^-[CZ].+/.test(arg)) continue;
    throw new Error(`Unsupported Cargo global option: ${arg}. Put build options after the command.`);
  }
  throw new Error('A Cargo command is required');
}

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
  if (cargoCommand(args) === 'clean') throw new Error('Shared caches must be inspected before cleaning. Use cargo clean explicitly outside this wrapper.');
  const next = { ...env };
  if (!next.CARGO_TARGET_DIR && !next.CARGO_BUILD_TARGET_DIR) {
    const base = next.XDG_CACHE_HOME || path.join(host.home, '.cache');
    if (!path.isAbsolute(base)) throw new Error('XDG_CACHE_HOME must be absolute');
    const architecture = host.arch === 'x64' ? 'x86_64' : host.platform === 'linux' && host.arch === 'arm64' ? 'aarch64' : host.arch;
    next.CARGO_TARGET_DIR = path.join(base, 'ait-kit', 'cargo-target', `${({ darwin: "Darwin", linux: "Linux", win32: "Windows_NT" })[host.platform] ?? host.platform}-${architecture}`);
  }
  if (!fullDebug) {
    next.CARGO_PROFILE_DEV_DEBUG ??= 'line-tables-only';
    next.CARGO_PROFILE_TEST_DEBUG ??= 'line-tables-only';
  }
  if (ephemeral) next.CARGO_INCREMENTAL ??= '0';
  return { args, env: next };
}

export function metadataInvocation(args, env) {
  const result = [];
  const next = { ...env };
  for (let i = 0; i < args.length; i++) {
    const [flag, ...inline] = args[i].split('=');
    const hasValue = inline.length > 0;
    const value = () => {
      const text = hasValue ? inline.join('=') : args[++i];
      if (!text || text.startsWith('--')) throw new Error(`${flag} requires a value`);
      return text;
    };
    if (flag === '--target-dir') next.CARGO_TARGET_DIR = path.resolve(value());
    else if (flag === '--target') result.push('--filter-platform', value());
    else if (['--profile', '--jobs', '-j', '--package', '-p', '--bin', '--example', '--test', '--bench', '--message-format'].includes(flag)) value();
    else if (['--release', '--workspace', '--all', '--lib', '--bins', '--examples', '--tests', '--benches', '--all-targets'].includes(flag)) continue;
    else if (['--manifest-path', '--config', '--color', '--features', '-F', '--filter-platform'].includes(flag)) result.push(flag, value());
    else if (['--offline', '--locked', '--frozen', '--no-default-features', '--all-features', '--quiet', '-q', '--verbose', '-v', '-vv'].includes(flag)) result.push(args[i]);
    else throw new Error(`Unsupported target-dir option: ${args[i]}`);
  }
  return { args: ['metadata', '--format-version', '1', '--no-deps', ...result], env: next };
}

export async function main(argv = process.argv.slice(2)) {
  const invocation = cargoInvocation(argv);
  if (invocation.args[0] === 'target-dir') {
    const metadata = metadataInvocation(invocation.args.slice(1), invocation.env);
    const result = spawnSync('cargo', metadata.args, {
      env: metadata.env, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(result.stderr || 'Cargo metadata failed');
    const target = JSON.parse(result.stdout).target_directory;
    if (typeof target !== 'string' || !path.isAbsolute(target)) throw new Error('Cargo metadata returned an invalid target directory');
    console.log(target);
    return 0;
  }
  // Run in the consumer's cwd: its rust-toolchain/config and manifest remain authoritative.
  return await new Promise((resolve, reject) => {
    const grouped = process.platform !== 'win32';
    const child = spawn('cargo', invocation.args, { env: invocation.env, stdio: 'inherit', detached: grouped });
    let interrupted;
    let escalation;
    const kill = (signal) => {
      try { if (grouped) process.kill(-child.pid, signal); else child.kill(signal); }
      catch (error) { if (error.code !== 'ESRCH') throw error; }
    };
    const signals = ['SIGTERM', 'SIGINT', 'SIGHUP'];
    const listeners = signals.map((signal) => {
      const listener = () => {
        if (interrupted) return;
        interrupted = signal;
        kill(signal);
        // Keep the wrapper alive until stubborn compiler descendants are also stopped.
        escalation = setTimeout(() => kill('SIGKILL'), 1000);
      };
      process.on(signal, listener);
      return listener;
    });
    const cleanup = () => signals.forEach((signal, i) => process.removeListener(signal, listeners[i]));
    child.on('error', (error) => { cleanup(); clearTimeout(escalation); reject(error); });
    child.on('exit', (code, signal) => {
      cleanup();
      resolve(interrupted ? (interrupted === 'SIGINT' ? 130 : 143) : code ?? (signal ? 1 : 0));
    });
  });
}
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  try { process.exitCode = await main(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
