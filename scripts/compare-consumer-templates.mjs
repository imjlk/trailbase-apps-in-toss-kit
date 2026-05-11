#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_DIFF_LINES = 120;
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const { consumerArg, mappingArg, strict } = parseArgs(args);

if (!consumerArg) {
  console.error(
    'Usage: node scripts/compare-consumer-templates.mjs <consumer-repo-path> [--strict] [--mapping <file>]',
  );
  process.exit(2);
}

const consumerRoot = resolve(process.cwd(), consumerArg);
if (!existsSync(consumerRoot)) {
  console.error(`Consumer path not found: ${consumerRoot}`);
  process.exit(2);
}

const consumerTrailbase = join(consumerRoot, 'apps/trailbase');
const searchRoot = existsSync(consumerTrailbase) ? consumerTrailbase : consumerRoot;

const checks = mappingArg ? mappingChecks(mappingArg) : discoveredChecks();

let hasDrift = false;
let hasMissing = false;

console.log(`Comparing kit templates against consumer: ${consumerRoot}`);
console.log(`Mode: ${strict ? 'strict' : 'advisory'}`);
if (mappingArg) {
  console.log(`Mapping: ${relative(consumerRoot, resolve(consumerRoot, mappingArg))}`);
}
console.log('');

for (const check of checks) {
  const templatePath = join(repoRoot, check.template);
  const candidates = unique(check.candidates).sort();
  console.log(`==> ${check.name}`);
  console.log(`template: ${check.template}`);

  if (candidates.length === 0) {
    hasMissing = true;
    console.log('candidate: <none found>');
    console.log('');
    continue;
  }

  for (const candidatePath of candidates) {
    const relCandidate = relative(consumerRoot, candidatePath);
    if (!existsSync(candidatePath)) {
      hasMissing = true;
      console.log(`candidate: ${relCandidate}`);
      console.log('status: missing');
      console.log('');
      continue;
    }

    const diff = spawnSync(
      'git',
      ['diff', '--no-index', '--color=never', '--', templatePath, candidatePath],
      { encoding: 'utf8' },
    );
    const different = diff.status !== 0;
    if (different) {
      hasDrift = true;
    }

    console.log(`candidate: ${relCandidate}`);
    if (!different) {
      console.log('status: identical');
    } else {
      printDiff(diff.stdout || diff.stderr || '<diff unavailable>');
    }
    console.log('');
  }
}

if (strict && (hasDrift || hasMissing)) {
  process.exit(1);
}

function parseArgs(values) {
  let foundConsumerArg = '';
  let foundMappingArg = '';
  let foundStrict = false;
  for (let index = 0; index < values.length; index += 1) {
    const arg = values[index];
    if (arg === '--strict') {
      foundStrict = true;
      continue;
    }
    if (arg === '--mapping') {
      foundMappingArg = values[index + 1] || '';
      index += 1;
      continue;
    }
    if (arg.startsWith('--mapping=')) {
      foundMappingArg = arg.slice('--mapping='.length);
      continue;
    }
    if (arg.startsWith('--')) {
      console.error(`Unknown option: ${arg}`);
      process.exit(2);
    }
    if (!foundConsumerArg) {
      foundConsumerArg = arg;
    }
  }
  return { consumerArg: foundConsumerArg, mappingArg: foundMappingArg, strict: foundStrict };
}

function discoveredChecks() {
  return [
    {
      name: 'SQL toss identities',
      template: 'templates/trailbase/sql/toss_identities.sql',
      candidates: findFiles(searchRoot, (file, text) => {
        return file.endsWith('.sql') && /toss_identities|toss_user_key_hmac/.test(text);
      }),
    },
    {
      name: 'Compose toss mTLS proxy',
      template: 'templates/trailbase/compose/toss-mtls-client-proxy.yml',
      candidates: findFiles(searchRoot, (file, text) => {
        return /docker-compose.*\.ya?ml$|toss.*proxy.*\.ya?ml$/i.test(file)
          && /toss-mtls-client-proxy|MTLS_PROXY/.test(text);
      }),
    },
    {
      name: 'Proxy env example',
      template: 'templates/trailbase/env/toss-mtls-client-proxy.env.example',
      candidates: findFiles(searchRoot, (file, text) => {
        return /(^|\/)\.env.*example$|\.env\.example$/i.test(file)
          && /MTLS_PROXY|TOSS_LOGIN|TOSS_USER_KEY/.test(text);
      }),
    },
    {
      name: 'Proxy smoke script',
      template: 'templates/trailbase/scripts/toss-proxy-smoke.sh',
      candidates: findFiles(searchRoot, (file, text) => {
        return /toss.*proxy.*smoke.*\.sh$/i.test(file) || (
          file.endsWith('.sh') && /\/internal\/apps-in-toss\//.test(text)
        );
      }),
    },
  ];
}

function mappingChecks(mappingPath) {
  const resolved = resolve(consumerRoot, mappingPath);
  let mapping;
  try {
    mapping = JSON.parse(readFileSync(resolved, 'utf8'));
  } catch (error) {
    console.error(`Failed to read mapping file ${resolved}: ${error.message}`);
    process.exit(2);
  }

  if (!Array.isArray(mapping.checks)) {
    console.error(`Mapping file must contain a checks array: ${resolved}`);
    process.exit(2);
  }

  return mapping.checks.map((entry, index) => {
    const template = stringField(entry, 'template', index);
    const name = entry.name || template;
    const consumer = entry.consumer ?? entry.candidate;
    const consumers = entry.consumers ?? entry.candidates ?? (consumer ? [consumer] : []);
    if (!Array.isArray(consumers) || consumers.length === 0) {
      console.error(`Mapping check ${index + 1} must include consumer or consumers`);
      process.exit(2);
    }
    return {
      name,
      template,
      candidates: consumers.map((candidate) => resolve(consumerRoot, String(candidate))),
    };
  });
}

function stringField(entry, field, index) {
  const value = entry?.[field];
  if (typeof value !== 'string' || value.trim() === '') {
    console.error(`Mapping check ${index + 1} must include ${field}`);
    process.exit(2);
  }
  return value;
}

function printDiff(raw) {
  const lines = raw.split('\n');
  const selected = lines.slice(0, MAX_DIFF_LINES).join('\n');
  console.log(selected);
  if (lines.length > MAX_DIFF_LINES) {
    console.log(
      `... diff truncated after ${MAX_DIFF_LINES} lines; run git diff --no-index with the shown paths for full output`,
    );
  }
}

function findFiles(root, predicate) {
  if (!existsSync(root)) {
    return [];
  }
  const out = [];
  walk(root, (file) => {
    let text = '';
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      return;
    }
    if (predicate(file, text)) {
      out.push(file);
    }
  });
  return out;
}

function walk(dir, onFile) {
  for (const entry of readdirSync(dir)) {
    if (shouldSkip(entry)) {
      continue;
    }
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walk(full, onFile);
    } else if (stat.isFile()) {
      onFile(full);
    }
  }
}

function shouldSkip(entry) {
  return [
    '.git',
    '.turbo',
    'build',
    'dist',
    'node_modules',
    'target',
    'trailbase-data',
  ].includes(entry);
}

function unique(values) {
  return [...new Set(values)];
}
