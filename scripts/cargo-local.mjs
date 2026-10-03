#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { homedir, platform, arch } from 'node:os';
import path from 'node:path';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Parse only documented Cargo global options, never guess where an option value ends.
function cargoCommand(args) {
  let i = args[0]?.startsWith('+') ? 1 : 0;
  for (; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith('-')) return { command: arg, index: i };
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
  if (host.platform === 'win32') throw new Error('Native Windows is not supported by this process-group runner. Run it inside WSL instead.');
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
  const { command, index: commandIndex } = cargoCommand(args);
  if (command === 'clean') throw new Error('Shared caches must be inspected before cleaning. Use cargo clean explicitly outside this wrapper.');
  // Cargo aliases can recurse or shadow external commands, including installed clippy/fmt.
  // Built-in command names cannot be overridden by aliases. Keep this runner deliberately narrow.
  const supported = new Set(['build', 'check', 'test', 'run', 'bench', 'doc', 'rustc', 'rustdoc', 'metadata', 'fetch', 'tree', 'help', 'target-dir']);
  if (!supported.has(command)) throw new Error(`Unsupported Cargo command: ${command}. Aliases and external commands must be invoked directly with an explicit target directory.`);
  const next = { ...env };
  // A --config value can be TOML or a file with arbitrary tables/quoted keys.
  // Let Cargo interpret it rather than overriding it or maintaining a partial TOML parser.
  const separator = args.indexOf('--');
  const cargoArgs = separator < 0 ? args : args.slice(0, separator);
  const explicitConfig = cargoArgs.some(arg => arg === '--config' || arg.startsWith('--config='));
  if (!next.CARGO_TARGET_DIR && !next.CARGO_BUILD_TARGET_DIR && !explicitConfig) {
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
  return { args, env: next, commandIndex };
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
  if (invocation.args[invocation.commandIndex] === 'target-dir') {
    const metadata = metadataInvocation(invocation.args.slice(invocation.commandIndex + 1), invocation.env);
    // Retain Rustup selectors and Cargo global options, but never forward the pseudo-command.
    const metadataArgs = [...invocation.args.slice(0, invocation.commandIndex), ...metadata.args];
    const result = await runCargo(metadataArgs, metadata.env, true);
    if (result.status !== 0) throw new Error(result.stderr || 'Cargo metadata failed');
    const target = JSON.parse(result.stdout).target_directory;
    if (typeof target !== 'string' || !path.isAbsolute(target)) throw new Error('Cargo metadata returned an invalid target directory');
    console.log(target);
    return 0;
  }
  // Run in the consumer's cwd; its toolchain and manifest remain authoritative.
  return (await runCargo(invocation.args, invocation.env)).status;
}

async function runCargo(args, env, capture = false) {
  return await new Promise((resolve, reject) => {
    const child = spawn('cargo', args, { env, stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit', detached: true });
    let stdout = '';
    let stderr = '';
    let bytes = 0;
    let outputError;
    let interrupted;
    let escalation;
    const kill = (signal) => {
      if (!child.pid) return;
      try { process.kill(-child.pid, signal); }
      catch (error) { if (error.code !== 'ESRCH') throw error; }
    };
    if (capture) {
      const append = (chunk, isError) => {
        if (outputError) return;
        bytes += Buffer.byteLength(chunk);
        if (bytes > 16 * 1024 * 1024) {
          outputError ??= new Error('Cargo metadata output exceeded 16 MiB');
          kill('SIGKILL');
          return;
        }
        if (isError) stderr += chunk; else stdout += chunk;
      };
      child.stdout.setEncoding('utf8').on('data', chunk => append(chunk, false));
      child.stderr.setEncoding('utf8').on('data', chunk => append(chunk, true));
    }
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
    child.on('close', (code, signal) => {
      cleanup();
      if (outputError) { reject(outputError); return; }
      const status = interrupted ? (interrupted === 'SIGINT' ? 130 : 143) : code ?? (signal ? 1 : 0);
      resolve({ status, stdout, stderr });
    });
  });
}
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  try { process.exitCode = await main(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
