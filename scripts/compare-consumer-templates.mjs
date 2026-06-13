#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_DIFF_LINES = 120;
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const { consumerArg, mappingArg, strict } = parseArgs(args);
const ALLOWED_MODES = new Set(['exact', 'compose-service', 'env-subset']);

if (!consumerArg) {
  console.error(
    'Usage: bun scripts/compare-consumer-templates.mjs <consumer-repo-path> [--strict] [--mapping <file>]',
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

    const comparison = compareCandidate(check, templatePath, candidatePath);
    if (comparison.missing) {
      hasMissing = true;
      console.log(`candidate: ${relCandidate}`);
      console.log(`status: ${comparison.missing}`);
      console.log('');
      continue;
    }

    if (comparison.different) {
      hasDrift = true;
    }

    console.log(`candidate: ${relCandidate}`);
    if (!comparison.different) {
      console.log(`status: ${comparison.status}`);
    } else {
      printDiff(comparison.diff || '<diff unavailable>');
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
    const mode = entry.mode || 'exact';
    if (!ALLOWED_MODES.has(mode)) {
      console.error(
        `Mapping check ${index + 1} mode must be one of ${[...ALLOWED_MODES].join(', ')}`,
      );
      process.exit(2);
    }
    const service = entry.service ?? entry.serviceName;
    if (mode === 'compose-service' && (typeof service !== 'string' || service.trim() === '')) {
      console.error(`Mapping check ${index + 1} must include service for compose-service mode`);
      process.exit(2);
    }
    const consumer = entry.consumer ?? entry.candidate;
    const consumers = entry.consumers ?? entry.candidates ?? (consumer ? [consumer] : []);
    if (!Array.isArray(consumers) || consumers.length === 0) {
      console.error(`Mapping check ${index + 1} must include consumer or consumers`);
      process.exit(2);
    }
    return {
      name,
      template,
      mode,
      service,
      volumes: Array.isArray(entry.volumes) ? entry.volumes.map(String) : [],
      candidates: consumers.map((candidate) => resolve(consumerRoot, String(candidate))),
    };
  });
}

function compareCandidate(check, templatePath, candidatePath) {
  if (check.mode === 'env-subset') {
    return compareEnvSubset(templatePath, candidatePath);
  }
  if (check.mode === 'compose-service') {
    return compareScopedText(
      scopedComposeText(check, templatePath),
      scopedComposeText(check, candidatePath),
      `${check.template}#${check.service}`,
      relative(consumerRoot, candidatePath),
    );
  }

  const diff = spawnSync(
    'git',
    ['diff', '--no-index', '--color=never', '--', templatePath, candidatePath],
    { encoding: 'utf8' },
  );
  return {
    different: diff.status !== 0,
    status: 'identical',
    diff: diff.stdout || diff.stderr,
  };
}

function compareEnvSubset(templatePath, candidatePath) {
  const templateEntries = parseActiveEnvEntries(readFileSync(templatePath, 'utf8'));
  const candidateEntries = parseActiveEnvEntries(readFileSync(candidatePath, 'utf8'));
  const candidateValues = new Map(candidateEntries.map((entry) => [entry.key, entry.value]));
  const missingKeys = templateEntries
    .filter((entry) => !candidateValues.has(entry.key))
    .map((entry) => entry.key);
  const mismatchedValues = templateEntries
    .filter((entry) => candidateValues.has(entry.key))
    .map((entry) => envSubsetValueMismatch(entry, candidateValues.get(entry.key)))
    .filter(Boolean);
  if (missingKeys.length === 0 && mismatchedValues.length === 0) {
    return {
      different: false,
      status: 'env subset present',
    };
  }

  const diff = [];
  if (missingKeys.length > 0) {
    diff.push(
      'env subset missing required keys:',
      ...missingKeys.map((key) => `- ${key}`),
    );
  }
  if (mismatchedValues.length > 0) {
    if (diff.length > 0) {
      diff.push('');
    }
    diff.push(
      'env subset mismatched fixed values:',
      ...mismatchedValues.map((message) => `- ${message}`),
    );
  }

  return {
    different: true,
    diff: diff.join('\n'),
  };
}

function scopedComposeText(check, filePath) {
  const text = readFileSync(filePath, 'utf8');
  const serviceBlock = extractYamlMappingEntry(text, 'services', check.service);
  if (!serviceBlock) {
    return { missing: `missing service ${check.service}` };
  }

  const sections = [`services:\n${serviceBlock}`];
  if (check.volumes.length > 0) {
    const volumeBlocks = [];
    for (const volume of check.volumes) {
      const volumeBlock = extractYamlMappingEntry(text, 'volumes', volume);
      if (!volumeBlock) {
        return { missing: `missing volume ${volume}` };
      }
      volumeBlocks.push(volumeBlock);
    }
    sections.push(`volumes:\n${volumeBlocks.join('')}`);
  }

  return { text: `${sections.join('\n')}\n` };
}

function compareScopedText(template, candidate, templateLabel, candidateLabel) {
  if (template.missing) {
    return { missing: `template ${template.missing}` };
  }
  if (candidate.missing) {
    return { missing: candidate.missing };
  }
  if (template.text === candidate.text) {
    return {
      different: false,
      status: 'scoped match',
    };
  }

  return {
    different: true,
    diff: scopedDiff(template.text, candidate.text, templateLabel, candidateLabel),
  };
}

function extractYamlMappingEntry(text, parentKey, entryKey) {
  const lines = text.split(/\r?\n/);
  const parentIndex = lines.findIndex((line) =>
    new RegExp(`^${escapeRegex(parentKey)}:\\s*(?:#.*)?$`).test(line),
  );
  if (parentIndex < 0) {
    return '';
  }

  const parentIndent = indentation(lines[parentIndex]);
  const parentEnd = findYamlBlockEnd(lines, parentIndex + 1, parentIndent);
  for (let index = parentIndex + 1; index < parentEnd; index += 1) {
    const line = lines[index];
    if (!line.trim()) {
      continue;
    }
    const entryIndent = indentation(line);
    if (
      entryIndent > parentIndent &&
      new RegExp(`^\\s{${entryIndent}}${escapeRegex(entryKey)}:\\s*`).test(line)
    ) {
      const entryEnd = findYamlBlockEnd(lines, index + 1, entryIndent);
      return `${trimTrailingBlankLines(lines.slice(index, entryEnd)).join('\n')}\n`;
    }
  }
  return '';
}

function findYamlBlockEnd(lines, start, baseIndent) {
  for (let index = start; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim()) {
      continue;
    }
    if (indentation(line) <= baseIndent) {
      return index;
    }
  }
  return lines.length;
}

function trimTrailingBlankLines(lines) {
  let end = lines.length;
  while (end > 0 && !lines[end - 1].trim()) {
    end -= 1;
  }
  return lines.slice(0, end);
}

function parseActiveEnvEntries(text) {
  const entries = [];
  const seen = new Set();
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const withoutExport = trimmed.startsWith('export ')
      ? trimmed.slice('export '.length).trim()
      : trimmed;
    const index = withoutExport.indexOf('=');
    if (index < 1) {
      continue;
    }
    const key = withoutExport.slice(0, index).trim();
    let value = withoutExport.slice(index + 1).trim();
    if (
      (value.startsWith("'") && value.endsWith("'")) ||
      (value.startsWith('"') && value.endsWith('"'))
    ) {
      value = value.slice(1, -1);
    } else {
      const commentIndex = value.search(/\s#/);
      if (commentIndex >= 0) {
        value = value.slice(0, commentIndex).trim();
      }
    }
    if (key && !seen.has(key)) {
      seen.add(key);
      entries.push({ key, value });
    }
  }
  return entries;
}

function envSubsetValueMismatch(templateEntry, candidateValue) {
  const { key, value } = templateEntry;
  if (!shouldCompareEnvSubsetValue(key, value)) {
    return null;
  }

  if (key === 'COMPOSE_PROFILES') {
    const requiredProfiles = splitList(value);
    const candidateProfiles = splitList(candidateValue);
    const missingProfiles = requiredProfiles.filter((profile) =>
      !candidateProfiles.includes(profile),
    );
    if (missingProfiles.length === 0) {
      return null;
    }
    return `${key} must include ${missingProfiles.join(', ')} (found ${displayEnvValue(candidateValue)})`;
  }

  if (candidateValue === value) {
    return null;
  }
  return `${key} expected ${displayEnvValue(value)}, found ${displayEnvValue(candidateValue)}`;
}

function shouldCompareEnvSubsetValue(key, value) {
  return Boolean(value) && !isSensitiveEnvKey(key) && !isPlaceholderEnvValue(value);
}

function isSensitiveEnvKey(key) {
  return /(^|_)(TOKEN|SECRET|PASSWORD|PRIVATE|HMAC|SEALED|USER_KEY)($|_)|(^|_)(CERT|KEY)_PATH$/i
    .test(key);
}

function isPlaceholderEnvValue(value) {
  return /replace-with|change-me|changeme|todo_|placeholder|example\.com|example\.invalid|<[^>]+>/.test(
    String(value).toLowerCase(),
  );
}

function splitList(value) {
  return String(value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function displayEnvValue(value) {
  return value ? JSON.stringify(value) : '<empty>';
}

function scopedDiff(templateText, candidateText, templateLabel, candidateLabel) {
  return [
    `--- ${templateLabel}`,
    `+++ ${candidateLabel}`,
    ...templateText.split('\n').map((line) => `- ${line}`),
    ...candidateText.split('\n').map((line) => `+ ${line}`),
  ].join('\n');
}

function indentation(line) {
  return line.match(/^\s*/)[0].length;
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
