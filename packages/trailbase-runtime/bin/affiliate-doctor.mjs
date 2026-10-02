#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { diagnoseAffiliateCatalog } from '../src/affiliate/diagnostics.mjs';
import { createTossSharelinkProvider } from '../src/affiliate/toss-sharelink.mjs';

const args = process.argv.slice(2);
const help = 'Usage: affiliate-doctor --policy <json> [--topics cleaning,food] [--rotation-key visit-1] [--live]\nDefault: offline policy validation. --live reads categories/products using server TOSS_SHOPPING_* environment; never issues links.';
if (args.includes('--help')) { console.log(help); process.exit(0); }
const values = {};
let live = false;
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--live') { live = true; continue; }
  if (!['--policy', '--topics', '--rotation-key'].includes(arg) || !args[i + 1] || args[i + 1].startsWith('--')) {
    console.error(help); process.exit(2);
  }
  values[arg] = args[++i];
}
if (!values['--policy']) { console.error(help); process.exit(2); }
try {
  const policy = JSON.parse(await readFile(values['--policy'], 'utf8'));
  const required = ['TOSS_SHOPPING_ACCESS_KEY', 'TOSS_SHOPPING_SECRET_KEY', 'TOSS_SHOPPING_PUBLISHER_ID'];
  if (live && required.some((key) => !process.env[key]?.trim())) {
    console.log(JSON.stringify({ schema: 'affiliate-diagnostics-v1', status: 'failed', code: 'missing-server-credentials',
      missing: required.filter((key) => !process.env[key]?.trim()) }));
    process.exit(1);
  }
  const provider = live ? createTossSharelinkProvider({ accessKey: process.env.TOSS_SHOPPING_ACCESS_KEY,
    secretKey: process.env.TOSS_SHOPPING_SECRET_KEY, publisherId: process.env.TOSS_SHOPPING_PUBLISHER_ID,
    subTagId: process.env.TOSS_SHOPPING_SUB_TAG_ID || undefined }) : undefined;
  const report = await diagnoseAffiliateCatalog({ policy, provider,
    topics: values['--topics']?.split(',') ?? [], rotationKey: values['--rotation-key'] ?? 'diagnostic' });
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.status === 'failed' ? 1 : 0;
} catch {
  console.error(JSON.stringify({ schema: 'affiliate-diagnostics-v1', status: 'failed', code: 'configuration-or-diagnostic-failed' }));
  process.exitCode = 1;
}
