import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Bun's isolated workspace store can exceed Windows path limits when this kit
// is checked out beneath a consumer's vendor directory. Keep Unix isolation.
const args = ['install', '--frozen-lockfile'];
if (process.platform === 'win32') args.push('--linker', 'hoisted');
const result = spawnSync(process.execPath, args, {
  cwd: fileURLToPath(new URL('..', import.meta.url)),
  stdio: 'inherit',
});
if (result.error) console.error(result.error.message);
process.exitCode = result.status ?? 1;
