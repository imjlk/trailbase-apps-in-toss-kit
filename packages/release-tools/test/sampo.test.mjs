import { afterEach, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createSampoReleaseTag, planSampoRelease, readSampoLockstep, syncCargoLockVersions } from '../src/sampo.mjs';
import { renderSampoReleaseNotes } from '../src/notes.mjs';
import { readReleaseContext } from '../src/ait.mjs';

const roots = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const git = (root, ...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
function put(root, path, value) { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), value); }
function fixture(count = 11) {
  const root = mkdtempSync(join(tmpdir(), 'kit-sampo-')); roots.push(root);
  git(root, 'init', '-b', 'main'); git(root, 'config', 'user.name', 'Test'); git(root, 'config', 'user.email', 'test@example.invalid');
  const ids = Array.from({ length: count }, (_, i) => i < count - 1 ? `npm/@test/package-${i}` : 'cargo/app-core');
  put(root, '.sampo/config.toml', `[packages]\nfixed = [${JSON.stringify(ids)}]\n`);
  ids.forEach((id, i) => put(root, `packages/${i}/${id.startsWith('npm/') ? 'package.json' : 'Cargo.toml'}`, id.startsWith('npm/') ? JSON.stringify({ name: id.slice(4), version: '1.6.5' }) : '[package]\nname = "app-core"\nversion = "1.6.5"\n'));
  git(root, 'add', '.'); git(root, 'commit', '-qm', 'fixture');
  git(root, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  return { root, anchor: ids[0], appName: 'test-app' };
}

test('discovers small and eleven-package groups, including the last npm and Rust packages', () => {
  for (const count of [2, 11]) expect(readSampoLockstep(fixture(count)).packages).toHaveLength(count);
  const input = fixture();
  put(input.root, 'packages/9/package.json', JSON.stringify({ name: '@test/package-9', version: '1.6.4' }));
  expect(() => readSampoLockstep(input)).toThrow('Lockstep version differs');
  put(input.root, 'packages/9/package.json', JSON.stringify({ name: '@test/package-9', version: '1.6.5' }));
  put(input.root, 'packages/10/Cargo.toml', '[package]\nname = "app-core"\nversion = "1.6.4"\n');
  expect(() => readSampoLockstep(input)).toThrow('Lockstep version differs');
});

test('rejects missing, duplicate, and inherited manifest versions', () => {
  const input = fixture(2);
  git(input.root, 'rm', '--cached', 'packages/1/Cargo.toml');
  expect(() => readSampoLockstep(input)).toThrow('no tracked manifest');
  git(input.root, 'add', 'packages/1/Cargo.toml');
  put(input.root, 'copy/package.json', JSON.stringify({ name: '@test/package-0', version: '1.6.5' }));
  git(input.root, 'add', 'copy');
  expect(() => readSampoLockstep(input)).toThrow('Multiple tracked manifests');
  git(input.root, 'rm', '--cached', 'copy/package.json');
  put(input.root, 'packages/1/Cargo.toml', '[package]\nname = "app-core"\nversion.workspace = true\n');
  expect(() => readSampoLockstep(input)).toThrow('Explicit stable package version');
});

test('synchronizes every Cargo lock without changing registry entries and validates before writing', () => {
  const input = fixture(2);
  const lock = 'version = 4\n\n[[package]]\nname = "app-core"\nversion = "1.6.4"\n\n[[package]]\nname = "registry-lib"\nversion = "2.0.0"\nsource = "registry+https://example.invalid"\nchecksum = "unchanged"\n';
  put(input.root, 'Cargo.lock', lock); put(input.root, 'nested/Cargo.lock', lock);
  git(input.root, 'add', '.');
  expect(syncCargoLockVersions(input)).toEqual(['Cargo.lock', 'nested/Cargo.lock']);
  for (const path of ['Cargo.lock', 'nested/Cargo.lock']) expect(readFileSync(join(input.root, path), 'utf8')).toBe(lock.replace('1.6.4', '1.6.5'));
  put(input.root, 'Cargo.lock', lock);
  put(input.root, 'nested/Cargo.lock', `${lock}\n[[package]]\nname = "ambiguous-consumer"\nversion = "1.0.0"\ndependencies = ["app-core 1.6.4"]\n`);
  expect(() => syncCargoLockVersions(input)).toThrow('version-qualified dependency');
  expect(readFileSync(join(input.root, 'Cargo.lock'), 'utf8')).toBe(lock);
});

test('tag creation requires a clean main release and never moves an existing tag', () => {
  const input = fixture(2);
  put(input.root, '.sampo/changesets/pending.md', 'pending');
  expect(planSampoRelease(input).tag).toBe('');
  expect(() => createSampoReleaseTag(input)).toThrow('pending changesets');
  rmSync(join(input.root, '.sampo/changesets/pending.md'));
  put(input.root, 'dirty.txt', 'dirty');
  expect(() => createSampoReleaseTag(input)).toThrow('clean');
  rmSync(join(input.root, 'dirty.txt'));
  expect(createSampoReleaseTag(input)).toBe('test-app-v1.6.5');
  const original = git(input.root, 'rev-parse', 'test-app-v1.6.5');
  expect(() => createSampoReleaseTag(input)).toThrow('existing tag');
  expect(git(input.root, 'rev-parse', 'test-app-v1.6.5')).toBe(original);
});

test('release notes deduplicate complete entries but preserve different continuation lines', () => {
  const input = fixture(2);
  for (const i of [0, 1]) put(input.root, `packages/${i}/CHANGELOG.md`, `# Changes\n\n## 1.6.5 (2026-09-13)\n\n### Fixes\n\n- Common change\n  Shared detail\n\n- Migration\n  Package ${i} detail\n\n## 1.6.4\n- Old entry\n`);
  const output = renderSampoReleaseNotes({ ...input, lockstep: readSampoLockstep(input) });
  expect(output.match(/Common change/g)).toHaveLength(1);
  expect(output).toContain('Package 0 detail'); expect(output).toContain('Package 1 detail');
  expect(output).not.toContain('Old entry');
});

test('upload context checks the tag target and main ancestry against the actual checkout', () => {
  const input = fixture(2);
  const options = { ...input, version: '1.6.5', requireTag: true, ref: 'refs/tags/test-app-v1.6.5' };
  git(input.root, 'tag', 'test-app-v1.6.5');
  expect(readReleaseContext(options).dirty).toBe(false);
  put(input.root, 'new.txt', 'change'); git(input.root, 'add', '.'); git(input.root, 'commit', '-qm', 'new');
  expect(() => readReleaseContext(options)).toThrow('Tag points at another commit');
  git(input.root, 'tag', '-d', 'test-app-v1.6.5'); git(input.root, 'tag', 'test-app-v1.6.5');
  expect(() => readReleaseContext(options)).toThrow();
  git(input.root, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  expect(readReleaseContext(options).commit).toBe(git(input.root, 'rev-parse', 'HEAD'));
});
