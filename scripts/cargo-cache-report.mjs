#!/usr/bin/env node
import { readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const skipped = new Set(['.git', 'node_modules', '.local', 'traildepot', 'release-output']);
export function findTargets(roots) {
  const targets = new Set();
  const visited = new Set();
  function visit(directory) {
    if (visited.has(directory)) return;
    visited.add(directory);
    if (existsSync(path.join(directory, '.rustc_info.json')) ||
        (path.basename(directory) === 'target' && existsSync(path.join(directory, 'CACHEDIR.TAG')))) {
      targets.add(directory);
      return;
    }
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && !skipped.has(entry.name)) visit(path.join(directory, entry.name));
    }
  }
  for (const root of roots) visit(path.resolve(root));
  return [...targets].sort();
}
export function report(roots) {
  return findTargets(roots).map((target) => {
    const size = spawnSync('du', ['-sk', target], { encoding: 'utf8' });
    if (size.status !== 0) throw new Error(`Cannot measure ${target}: ${size.stderr.trim()}`);
    return { path: target, allocatedKiB: Number(size.stdout.split(/\s+/)[0]) };
  }).sort((a, b) => b.allocatedKiB - a.allocatedKiB);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const roots = process.argv.slice(2);
    if (!roots.length) throw new Error('Usage: cargo-cache-report.mjs <checkout-or-cache-root> [...] (read-only, no deletion)');
    const targets = report(roots);
    console.log(JSON.stringify({ targets, totalAllocatedKiB: targets.reduce((n, t) => n + t.allocatedKiB, 0),
      note: 'Allocated-block estimates; clones/shared blocks can overlap. This report does not determine whether a target is in use.' }, null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
