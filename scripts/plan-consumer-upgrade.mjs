#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildUpgradePlan, renderUpgradePlan } from './lib/consumer-upgrade-plan.mjs';

const usage = 'Usage: bun scripts/plan-consumer-upgrade.mjs <consumer-root> --from <kit-ref> --mapping <consumer-relative-map> [--to HEAD] [--json] [--strict]';
try {
  const options = {};
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help') { console.log(usage); process.exit(0); }
    if (arg === '--json' || arg === '--strict') { options[arg.slice(2)] = true; continue; }
    if (['--from', '--to', '--mapping'].includes(arg)) {
      if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Missing value for ${arg}.`);
      options[arg.slice(2)] = args[++i]; continue;
    }
    if (arg.startsWith('-') || options.consumerRoot) throw new Error('Unknown option or extra consumer path.');
    options.consumerRoot = resolve(arg);
  }
  if (!options.consumerRoot || !options.from || !options.mapping) throw new Error(usage);
  let mapping;
  try { mapping = JSON.parse(readFileSync(resolve(options.consumerRoot, options.mapping), 'utf8')); }
  catch { throw new Error('Could not read mapping JSON.'); }
  const plan = buildUpgradePlan({ ...options, mapping, kitRoot: resolve(dirname(fileURLToPath(import.meta.url)), '..') });
  console.log(options.json ? JSON.stringify(plan, null, 2) : renderUpgradePlan(plan));
  if (options.strict && plan.requiresReview) process.exitCode = 1;
} catch (error) {
  console.error(error.message);
  process.exitCode = 2;
}
