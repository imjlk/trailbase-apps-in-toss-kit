#!/usr/bin/env node
import { readdirSync, existsSync, lstatSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const skipped = new Set(['.git', 'node_modules', '.local', 'traildepot', 'release-output']);
export function findTargets(roots, { readDirectory = readdirSync } = {}) {
  const targets = new Set();
  const visited = new Set();
  function visit(directory, boundary) {
    if (visited.has(directory)) return;
    // Dirent information may be stale. Revalidate each descent and its root boundary.
    let stat;
    try {
      stat = lstatSync(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink()) return;
      const relative = path.relative(boundary, realpathSync(directory));
      if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return;
    } catch (error) {
      if (['ENOENT', 'ENOTDIR', 'ELOOP'].includes(error.code)) return;
      throw error;
    }
    // Compare canonical names separately: /tmp may itself be a platform-managed symlink.
    const canonical = realpathSync(directory);
    const unchanged = () => {
      try { const current = lstatSync(directory); return current.isDirectory() && current.dev === stat.dev && current.ino === stat.ino && realpathSync(directory) === canonical; }
      catch { return false; }
    };
    visited.add(directory);
    if (existsSync(path.join(directory, '.rustc_info.json')) ||
        (path.basename(directory) === 'target' && existsSync(path.join(directory, 'CACHEDIR.TAG')))) {
      if (unchanged()) targets.add(directory);
      return;
    }
    let entries;
    try { entries = readDirectory(directory, { withFileTypes: true }); }
    catch (error) { if (['ENOENT', 'ENOTDIR', 'ELOOP'].includes(error.code)) return; throw error; }
    if (!unchanged()) return;
    for (const entry of entries) {
      if (!unchanged()) return;
      if (entry.isDirectory() && !skipped.has(entry.name)) visit(path.join(directory, entry.name), boundary);
    }
  }
  for (const root of roots) {
    const directory = path.resolve(root);
    if (!lstatSync(directory).isSymbolicLink()) visit(directory, realpathSync(directory));
  }
  return [...targets].sort();
}
export function report(roots, measure = spawnSync) {
  return findTargets(roots).map((target) => {
    const size = measure('du', ['-sk', target], { encoding: 'utf8' });
    if (size.error) throw new Error(`Cannot measure ${target}: a Unix-compatible du command is required (${size.error.code ?? size.error.message})`);
    if (size.status !== 0) throw new Error(`Cannot measure ${target}: ${size.stderr?.trim() || size.signal || 'du failed'}`);
    const allocatedKiB = Number(size.stdout?.trim().split(/\s+/)[0]);
    if (!Number.isFinite(allocatedKiB) || allocatedKiB < 0 || !size.stdout?.trim()) throw new Error(`Invalid du output for ${target}`);
    return { path: target, allocatedKiB };
  }).sort((a, b) => b.allocatedKiB - a.allocatedKiB);
}
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  try {
    const roots = process.argv.slice(2);
    if (!roots.length) throw new Error('Usage: cargo-cache-report.mjs <checkout-or-cache-root> [...] (read-only, no deletion)');
    const targets = report(roots);
    console.log(JSON.stringify({ targets, totalAllocatedKiB: targets.reduce((n, t) => n + t.allocatedKiB, 0),
      note: 'Allocated-block estimates; clones/shared blocks can overlap. This report does not determine whether a target is in use.' }, null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
