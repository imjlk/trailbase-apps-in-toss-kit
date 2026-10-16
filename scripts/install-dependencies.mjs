import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { removeIsolatedWorkspaceLinks } from './lib/workspace-install-links.mjs';

// Bun's isolated workspace store can exceed Windows path limits when this kit
// is checked out beneath a consumer's vendor directory. Keep Unix isolation.
const args = ['install', '--frozen-lockfile'];
if (process.platform === 'win32') args.push('--linker', 'hoisted');
const root = fileURLToPath(new URL('..', import.meta.url));
const removed = removeIsolatedWorkspaceLinks({ root });
if (removed.length) console.log(`Removed ${removed.length} stale isolated workspace links before hoisted installation.`);
const result = spawnSync(process.execPath, args, {
  cwd: root,
  stdio: 'inherit',
});
if (result.error) console.error(result.error.message);
process.exitCode = result.status ?? 1;
