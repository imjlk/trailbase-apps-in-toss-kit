import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { syncCargoLockVersions } from '../packages/release-tools/src/sampo.mjs';

// Run on the clean, generated release branch before synchronizing bun.lock.
// Sampo may re-resolve Cargo dependencies; restore the common main ancestor's
// pins, then update only the fixed group's local package versions.
export function syncReleaseCargoLocks({ root, baseRef }) {
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const directory = statSync(root, { bigint: true });
  const repository = statSync(git('rev-parse', '--show-toplevel'), { bigint: true });
  assert(directory.ino !== 0n && directory.dev === repository.dev && directory.ino === repository.ino, 'Release root must be the repository root');
  assert.equal(git('status', '--porcelain'), '', 'Release checkout must be clean');
  const base = git('rev-parse', '--verify', `${baseRef}^{commit}`);
  assert.equal(git('merge-base', base, 'HEAD'), base, 'Release base must be an ancestor of HEAD');
  const locks = paths => paths.split('\0').filter(path => !path.startsWith('vendor/') && /(?:^|\/)Cargo\.lock$/.test(path)).sort();
  const before = locks(git('ls-tree', '-r', '--name-only', '-z', base));
  const current = locks(git('ls-files', '-z'));
  assert(before.length > 0, 'No tracked Cargo locks to synchronize');
  assert.deepEqual(current, before, 'Release added or removed a Cargo lockfile');
  git('restore', '--source', base, '--worktree', '--', ...before);
  syncCargoLockVersions({ root, anchor: 'cargo/trailbase-guest-common' });
  return { base, locks: before };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  assert(args.length === 2 && args[0] === '--base', 'Usage: bun scripts/sync-release-cargo-locks.mjs --base git-ref');
  console.log(JSON.stringify(syncReleaseCargoLocks({ root: process.cwd(), baseRef: args[1] })));
}
