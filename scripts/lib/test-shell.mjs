import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

// Windows' system bash.exe is a WSL launcher. Use the shell shipped with Git
// for Windows so native tests do not require a configured Linux distribution.
export function testShell(name) {
  if (process.platform !== 'win32') return name;
  const git = spawnSync('git', ['--exec-path'], { encoding: 'utf8' });
  const executable = path.resolve(git.stdout?.trim() ?? '', '../../../usr/bin', `${name}.exe`);
  if (git.status !== 0 || !existsSync(executable)) throw new Error('Shell tests require Git for Windows with Git Bash installed.');
  return executable;
}

export function shellPath(value) {
  return process.platform === 'win32' ? value.replaceAll('\\', '/') : value;
}

export function spawnTestShell(name, args, options = {}) {
  const executable = testShell(name);
  const env = { ...(options.env ?? process.env) };
  if (process.platform === 'win32') env.PATH = `${path.dirname(executable)}${path.delimiter}${env.PATH ?? ''}`;
  return spawnSync(executable, args, { ...options, env });
}
