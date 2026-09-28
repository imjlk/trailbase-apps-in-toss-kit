import { assertReleaseDependenciesUnchanged } from '../packages/release-tools/src/dependency-guard.mjs';
const args = process.argv.slice(2);
const options = { root: process.cwd(), baseRef: 'HEAD' };
for (let i = 0; i < args.length; i++) {
  if (!['--root', '--base'].includes(args[i]) || !args[i + 1]) throw new Error('Usage: bun check-release-dependencies.mjs [--root path] [--base git-ref]');
  options[args[i] === '--root' ? 'root' : 'baseRef'] = args[++i];
}
console.log(JSON.stringify(assertReleaseDependenciesUnchanged(options)));
