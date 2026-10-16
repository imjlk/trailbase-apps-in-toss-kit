import { afterEach, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { syncReleaseCargoLocks } from './sync-release-cargo-locks.mjs';
import { assertReleaseDependenciesUnchanged } from '../packages/release-tools/src/dependency-guard.mjs';

const roots = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const git = (root, ...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const put = (root, path, value) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), value); };
const lock = version => `version = 4\n\n[[package]]\nname = "trailbase-guest-common"\nversion = "${version}"\ndependencies = ["registry-lib"]\n\n[[package]]\nname = "registry-lib"\nversion = "2.0.0"\nsource = "registry+https://example.invalid"\nchecksum = "preserved"\n`;
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'kit-release-locks-')); roots.push(root);
  git(root, 'init', '-b', 'main'); git(root, 'config', 'core.autocrlf', 'false');
  git(root, 'config', 'user.name', 'Test'); git(root, 'config', 'user.email', 'test@example.invalid');
  put(root, '.sampo/config.toml', '[packages]\nfixed = [["cargo/trailbase-guest-common"]]\n');
  put(root, 'Cargo.toml', '[package]\nname = "trailbase-guest-common"\nversion = "1.0.0"\n');
  for (const path of ['Cargo.lock', 'nested/Cargo.lock']) put(root, path, lock('1.0.0'));
  git(root, 'add', '.'); git(root, 'commit', '-qm', 'main dependency pins');
  const baseRef = git(root, 'rev-parse', 'HEAD');
  put(root, 'Cargo.toml', '[package]\nname = "trailbase-guest-common"\nversion = "1.1.0"\n');
  for (const path of ['Cargo.lock', 'nested/Cargo.lock']) put(root, path, lock('1.1.0').replace('2.0.0', '2.1.0').replace('preserved', 'drifted'));
  git(root, 'add', '.'); git(root, 'commit', '-qm', 'Sampo release with unrelated dependency drift');
  return { root, baseRef };
}

test('restores base registry pins in all locks while retaining release versions; second run is a no-op', () => {
  const input = fixture();
  expect(() => assertReleaseDependenciesUnchanged(input)).toThrow('Dependency drift');
  expect(syncReleaseCargoLocks(input).locks).toEqual(['Cargo.lock', 'nested/Cargo.lock']);
  for (const path of ['Cargo.lock', 'nested/Cargo.lock']) expect(readFileSync(join(input.root, path), 'utf8')).toBe(lock('1.1.0'));
  expect(assertReleaseDependenciesUnchanged(input).checked).toHaveLength(2);
  git(input.root, 'add', '.'); git(input.root, 'commit', '-qm', 'synchronize release locks');
  syncReleaseCargoLocks(input);
  expect(git(input.root, 'status', '--porcelain')).toBe('');
});

test('refuses dirty checkouts and added/removed lockfiles without overwriting local data', () => {
  const input = fixture();
  put(input.root, 'Cargo.lock', 'local edits');
  expect(() => syncReleaseCargoLocks(input)).toThrow('must be clean');
  expect(readFileSync(join(input.root, 'Cargo.lock'), 'utf8')).toBe('local edits');
  git(input.root, 'restore', 'Cargo.lock');
  git(input.root, 'rm', 'nested/Cargo.lock'); git(input.root, 'commit', '-qm', 'remove lock');
  const before = readFileSync(join(input.root, 'Cargo.lock'), 'utf8');
  expect(() => syncReleaseCargoLocks(input)).toThrow('added or removed');
  expect(readFileSync(join(input.root, 'Cargo.lock'), 'utf8')).toBe(before);
});
