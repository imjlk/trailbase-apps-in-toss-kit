#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const SUBMODULE_PATH = 'vendor/trailbase-apps-in-toss-kit';

const args = process.argv.slice(2);
const strict = args.includes('--strict');
const consumerArg = args.find((arg) => arg !== '--strict');

if (!consumerArg) {
  console.error(
    'Usage: bun scripts/check-consumer-submodule.mjs <consumer-repo-path> [--strict]',
  );
  process.exit(2);
}

const consumerRoot = resolve(process.cwd(), consumerArg);
if (!existsSync(consumerRoot)) {
  console.error(`Consumer path not found: ${consumerRoot}`);
  process.exit(2);
}

const submoduleRoot = join(consumerRoot, SUBMODULE_PATH);
if (!existsSync(submoduleRoot)) {
  console.error(`Submodule path not found: ${submoduleRoot}`);
  process.exit(strict ? 1 : 0);
}

const indexGitlink = readIndexGitlink(consumerRoot, SUBMODULE_PATH);
const headGitlink = readHeadGitlink(consumerRoot, SUBMODULE_PATH);
const checkoutHead = runGit(submoduleRoot, ['rev-parse', 'HEAD']);

console.log(`Checking kit submodule for consumer: ${consumerRoot}`);
console.log(`submodule: ${relative(consumerRoot, submoduleRoot)}`);
console.log(`HEAD gitlink: ${headGitlink || '<not found>'}`);
console.log(`index gitlink: ${indexGitlink || '<not found>'}`);
console.log(`checkout HEAD: ${checkoutHead || '<not found>'}`);

let ok = true;
if (!indexGitlink) {
  ok = false;
  console.log('status: missing gitlink in consumer index');
} else if (!checkoutHead) {
  ok = false;
  console.log('status: submodule checkout has no readable HEAD');
} else if (indexGitlink !== checkoutHead) {
  ok = false;
  console.log('status: mismatch');
  console.log('hint: run git add vendor/trailbase-apps-in-toss-kit after updating the submodule');
} else {
  console.log('status: matched');
}

if (!ok && strict) {
  process.exit(1);
}

function readIndexGitlink(root, path) {
  const output = runGit(root, ['ls-files', '--stage', '--', path]);
  const match = output.match(/^160000\s+([0-9a-f]{40})\s+\d+\t/);
  return match?.[1] ?? '';
}

function readHeadGitlink(root, path) {
  const output = runGit(root, ['ls-tree', 'HEAD', '--', path]);
  const match = output.match(/^160000 commit ([0-9a-f]{40})\t/);
  return match?.[1] ?? '';
}

function runGit(cwd, gitArgs) {
  const result = spawnSync('git', gitArgs, {
    cwd,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    return '';
  }
  return result.stdout.trim();
}
