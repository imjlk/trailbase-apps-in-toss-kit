import assert from 'node:assert/strict';
import { lstatSync, readFileSync, readdirSync, readlinkSync, unlinkSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

function entries(path) {
  try {
    // Never traverse a node_modules or scope directory that is itself a link.
    if (!lstatSync(path).isDirectory() || lstatSync(path).isSymbolicLink()) return [];
    return readdirSync(path, { withFileTypes: true });
  } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}

export function removeIsolatedWorkspaceLinks({ root, platform = process.platform }) {
  if (platform !== 'win32') return [];
  assert(globalThis.Bun?.Glob, 'Workspace installation requires Bun');
  const inside = (parent, child) => {
    const path = relative(parent, child);
    return path !== '' && path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path);
  };
  const store = resolve(root, 'node_modules/.bun');
  const { workspaces = [] } = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
  assert(Array.isArray(workspaces), 'Expected a workspace pattern array');
  const removed = [];
  for (const pattern of workspaces) {
    for (const manifest of new Bun.Glob(`${pattern}/package.json`).scanSync({ cwd: root, onlyFiles: true })) {
      const modules = resolve(root, dirname(manifest), 'node_modules');
      assert(inside(resolve(root), modules), 'Workspace modules must stay inside the kit');
      const candidates = entries(modules).flatMap(entry => entry.name.startsWith('@')
        ? entries(resolve(modules, entry.name)).map(child => resolve(modules, entry.name, child.name))
        : [resolve(modules, entry.name)]);
      for (const link of candidates) {
        if (!lstatSync(link).isSymbolicLink()) continue;
        const target = resolve(dirname(link), readlinkSync(link));
        if (!inside(store, target)) continue;
        // unlink removes only the junction/symlink, never the target or a real
        // package directory. Leave custom links and other stores untouched.
        unlinkSync(link);
        removed.push(relative(root, link));
      }
    }
  }
  return removed;
}
