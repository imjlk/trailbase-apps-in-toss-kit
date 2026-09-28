import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Compare semantic lock data, permitting only local workspace version bumps.
export function releaseDependencyState(path, source) {
  assert(globalThis.Bun?.JSONC?.parse && globalThis.Bun?.TOML?.parse, 'Run dependency checks with Bun');
  if (path.endsWith('bun.lock')) {
    const lock = Bun.JSONC.parse(source);
    assert(lock && typeof lock.packages === 'object' && typeof lock.workspaces === 'object', 'Unsupported Bun lock structure');
    for (const workspace of Object.values(lock.workspaces)) delete workspace.version;
    return lock;
  }
  const lock = Bun.TOML.parse(source);
  assert(Array.isArray(lock.package), 'Unsupported Cargo lock structure');
  const locals = new Map(lock.package.filter(p => !p.source).map(p => [p.name, p.version]));
  for (const pkg of lock.package) {
    if (!pkg.source) delete pkg.version;
    if (pkg.dependencies) pkg.dependencies = pkg.dependencies.map(dep => {
      for (const [name, version] of locals) if (dep === `${name} ${version}`) return `${name} <workspace>`;
      return dep;
    }).sort();
  }
  lock.package.sort((a, b) => `${a.name}:${a.source ?? ''}:${a.version ?? ''}`.localeCompare(`${b.name}:${b.source ?? ''}:${b.version ?? ''}`));
  return lock;
}

export function assertReleaseDependenciesUnchanged({ root, baseRef = 'HEAD' }) {
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const base = git(['rev-parse', '--verify', `${baseRef}^{commit}`]).trim();
  const oldPaths = git(['ls-tree', '-r', '--name-only', '-z', base]).split('\0');
  const newPaths = git(['ls-files', '-z']).split('\0');
  const locks = [...new Set([...oldPaths, ...newPaths])].filter(p => !p.startsWith('vendor/') && /(?:^|\/)(?:bun\.lock|Cargo\.lock)$/.test(p));
  assert(locks.length > 0, 'No tracked Bun or Cargo locks to check');
  for (const path of locks) {
    assert(oldPaths.includes(path) && newPaths.includes(path), `Release added or removed lockfile: ${path}`);
    const before = releaseDependencyState(path, git(['show', `${base}:${path}`]));
    const after = releaseDependencyState(path, readFileSync(resolve(root, path), 'utf8'));
    assert.deepEqual(after, before, `Dependency drift in ${path}; keep dependency updates separate from version-only releases`);
  }
  return { checked: locks, base };
}
