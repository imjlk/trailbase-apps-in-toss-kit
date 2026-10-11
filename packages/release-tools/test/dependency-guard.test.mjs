import { expect, test } from 'bun:test';
import { releaseDependencyState, assertReleaseDependenciesUnchanged } from '../src/dependency-guard.mjs';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
const bunLock = (version, dependency = 'dep@1.0.0') => JSON.stringify({ lockfileVersion: 1, workspaces: { '': { name: 'app', version, dependencies: { dep: '^1.0.0' } } }, packages: { dep: [dependency, '', {}, 'hash'] } });
test('Bun comparison ignores workspace version only', () => {
  expect(releaseDependencyState('bun.lock', bunLock('1.0.0'))).toEqual(releaseDependencyState('bun.lock', bunLock('1.1.0')));
  expect(releaseDependencyState('bun.lock', bunLock('1.0.0'))).not.toEqual(releaseDependencyState('bun.lock', bunLock('1.1.0', 'dep@1.1.0')));
});
test('Cargo comparison retains registry versions and checksums', () => {
  const source = version => `version = 4\n[[package]]\nname = "app"\nversion = "${version}"\n[[package]]\nname = "dep"\nversion = "1.0.0"\nsource = "registry+https://example.invalid"\nchecksum = "hash"\n`;
  expect(releaseDependencyState('Cargo.lock', source('1.0.0'))).toEqual(releaseDependencyState('Cargo.lock', source('1.1.0')));
  expect(releaseDependencyState('Cargo.lock', source('1.0.0'))).not.toEqual(releaseDependencyState('Cargo.lock', source('1.0.0').replace('checksum = "hash"','checksum = "changed"')));
});
test('guard compares current checkout to a pinned commit without changing files', () => {
  const root = mkdtempSync(join(tmpdir(), 'release-guard-'));
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  try {
    git('init'); git('config','user.name','test'); git('config','user.email','test@example.invalid');
    writeFileSync(join(root,'bun.lock'),bunLock('1.0.0')); git('add','.'); git('commit','-m','base');
    writeFileSync(join(root,'bun.lock'),bunLock('1.1.0'));
    expect(assertReleaseDependenciesUnchanged({root}).checked).toEqual(['bun.lock']);
    writeFileSync(join(root,'bun.lock'),bunLock('1.1.0','dep@1.1.0'));
    expect(() => assertReleaseDependenciesUnchanged({root})).toThrow('Dependency drift');
  } finally { rmSync(root,{recursive:true,force:true}); }
});

test('directory aliases identify the same repository without accepting subdirectories or hiding drift', () => {
  const parent = mkdtempSync(join(tmpdir(), 'release guard alias '));
  const root = join(parent, 'repository');
  mkdirSync(root);
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  try {
    git('init'); git('config', 'user.name', 'test'); git('config', 'user.email', 'test@example.invalid');
    writeFileSync(join(root, 'bun.lock'), bunLock('1.0.0')); git('add', '.'); git('commit', '-m', 'base');
    const alias = join(parent, 'alias');
    const linkType = process.platform === 'win32' ? 'junction' : 'dir';
    symlinkSync(root, alias, linkType);
    expect(assertReleaseDependenciesUnchanged({ root: alias }).checked).toEqual(['bun.lock']);
    mkdirSync(join(root, 'sub'));
    const subAlias = join(parent, 'sub-alias');
    symlinkSync(join(root, 'sub'), subAlias, linkType);
    expect(() => assertReleaseDependenciesUnchanged({ root: subAlias })).toThrow('repository root');
    writeFileSync(join(root, 'bun.lock'), bunLock('1.0.0', 'dep@1.1.0'));
    expect(() => assertReleaseDependenciesUnchanged({ root: alias })).toThrow('Dependency drift');
  } finally { rmSync(parent, { recursive: true, force: true }); }
});

test('version-qualified local Cargo dependencies normalize without hiding registry changes', () => {
  const lock = version => `version = 4\n[[package]]\nname = "app"\nversion = "${version}"\ndependencies = ["local ${version}", "remote 1.0.0 (registry+https://example.invalid)"]\n[[package]]\nname = "local"\nversion = "${version}"\n[[package]]\nname = "remote"\nversion = "1.0.0"\nsource = "registry+https://example.invalid"\nchecksum = "hash"\n`;
  expect(releaseDependencyState('Cargo.lock', lock('1.0.0'))).toEqual(releaseDependencyState('Cargo.lock', lock('1.1.0')));
  expect(releaseDependencyState('Cargo.lock', lock('1.0.0'))).not.toEqual(releaseDependencyState('Cargo.lock', lock('1.0.0').replace('remote 1.0.0 (', 'remote 1.1.0 (')));
});

test('guard rejects untracked lock additions and gives an explicit subdirectory error', () => {
  const root = mkdtempSync(join(tmpdir(), 'release-guard-path-'));
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  try {
    git('init'); git('config','user.name','test'); git('config','user.email','test@example.invalid');
    writeFileSync(join(root,'bun.lock'),bunLock('1.0.0')); git('add','.'); git('commit','-m','base');
    writeFileSync(join(root,'Cargo.lock'),'version = 4\n[[package]]\nname = "app"\nversion = "1.0.0"\n');
    expect(() => assertReleaseDependenciesUnchanged({root})).toThrow('Release added or removed lockfile');
    mkdirSync(join(root,'nested'));
    expect(() => assertReleaseDependenciesUnchanged({root:join(root,'nested')})).toThrow('Release root must be the repository root');
  } finally { rmSync(root,{recursive:true,force:true}); }
});
