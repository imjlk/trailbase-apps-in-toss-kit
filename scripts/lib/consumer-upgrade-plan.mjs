import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { extractYamlMappingEntry, parseActiveEnvEntries } from './consumer-template-text.mjs';

const LIMIT = 1024 * 1024;
const MODES = new Set(['exact', 'env-subset', 'compose-service']);

function git(root, args, accepted = [0]) {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: LIMIT * 8 });
  if (result.error || !accepted.includes(result.status)) throw new Error('Git comparison failed; check refs and repository history.');
  return result;
}

function relativePath(value) {
  if (typeof value !== 'string' || !value || isAbsolute(value) || value.includes('\\') ||
      value.split('/').some(part => !part || part === '.' || part === '..') || /[\x00-\x1f\x7f]/.test(value)) {
    throw new Error('Mapping paths must be relative paths without traversal or control characters.');
  }
  return value;
}

function consumerFile(root, name) {
  const path = resolve(root, relativePath(name));
  if (!existsSync(path)) return null;
  const resolved = realpathSync(path);
  const rel = relative(root, resolved);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error('Mapped consumer path escapes the consumer root.');
  if (!statSync(resolved).isFile() || statSync(resolved).size > LIMIT) throw new Error('Mapped input must be a text file of at most 1 MiB.');
  return { text: text(readFileSync(resolved)), executable: Boolean(statSync(resolved).mode & 0o100) };
}

export function readConsumerMapping(consumerRoot, name) {
  const file = consumerFile(realpathSync(consumerRoot), name);
  if (!file) throw new Error('Could not read the mapping file.');
  try { return JSON.parse(file.text); }
  catch { throw new Error('Mapping contains invalid JSON.'); }
}

function text(bytes) {
  if (bytes.includes(0)) throw new Error('Binary inputs are not supported.');
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw new Error('Inputs must contain valid UTF-8 text.'); }
}

function kitFile(root, ref, path) {
  const entry = git(root, ['ls-tree', '-z', ref, '--', path]).stdout;
  if (!entry) return null;
  if (!/^100(644|755) blob /.test(entry)) throw new Error('Mapped kit input must be a regular file.');
  const size = Number(git(root, ['cat-file', '-s', `${ref}:${path}`]).stdout);
  if (size > LIMIT) throw new Error('Mapped kit input exceeds 1 MiB.');
  const result = spawnSync('git', ['-C', root, 'show', `${ref}:${path}`], { maxBuffer: LIMIT + 1 });
  if (result.status !== 0 || result.error) throw new Error('Could not read mapped kit input.');
  return { text: text(result.stdout), executable: entry.startsWith('100755 ') };
}

function scope(value, check, component) {
  if (value === null || check.mode !== 'compose-service') return value;
  const entry = extractYamlMappingEntry(value, component.section, component.name);
  return entry ? `${component.section}:\n${entry}` : null;
}

function state(base, next, consumer) {
  if (consumer === null && next !== null && base === next) return 'missing-consumer';
  if (base === next) return consumer === next ? 'unchanged' : 'consumer-only';
  if (consumer === next) return 'already-applied';
  if (consumer === base) return next === null ? 'kit-removed' : 'update-required';
  if (base === null || next === null || consumer === null) return 'conflict';
  return 'both-changed';
}

function combinedState(content, mode) {
  const states = [content, mode];
  for (const status of ['conflict', 'missing-consumer', 'kit-removed', 'mergeable-update']) {
    if (states.includes(status)) return status;
  }
  if (states.includes('update-required')) return states.includes('consumer-only') ? 'mergeable-update' : 'update-required';
  if (states.includes('already-applied')) return 'already-applied';
  return states.includes('consumer-only') ? 'consumer-only' : 'unchanged';
}

// Git sees only opaque line numbers. Consumer contents (including env values)
// never enter a temporary file, subprocess output, or the resulting report.
function compareLines(base, next, consumer) {
  const ids = new Map();
  function encode(value) {
    if (value === null) return '';
    return (value.match(/[^\n]*\n|[^\n]+$/g) ?? []).map(line => {
      if (!ids.has(line)) ids.set(line, String(ids.size + 1));
      return `${ids.get(line)}\n`;
    }).join('');
  }
  const dir = mkdtempSync(join(tmpdir(), 'kit-upgrade-'));
  try {
    for (const [name, value] of [['base', base], ['next', next], ['consumer', consumer]]) {
      writeFileSync(join(dir, name), encode(value), { mode: 0o600 });
    }
    function hunks(name) {
      const output = git(dir, ['diff', '--no-index', '--no-ext-diff', '--no-textconv', '--unified=0', '--', 'base', name], [0, 1]).stdout;
      return [...output.matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm)].map(m => ({
        baseStart: Number(m[1]), baseLines: Number(m[2] ?? 1), changedStart: Number(m[3]), changedLines: Number(m[4] ?? 1),
      }));
    }
    const merge = git(dir, ['merge-file', '--stdout', '--quiet', 'consumer', 'base', 'next'], Array.from({ length: 128 }, (_, i) => i));
    return { mergeable: merge.status === 0, kitHunks: hunks('next'), consumerHunks: hunks('consumer') };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

function compareEnv(base, next, consumer) {
  const maps = [base, next, consumer].map(value => new Map(parseActiveEnvEntries(value ?? '').map(entry => [entry.key, entry.value])));
  const keys = new Set([...maps[0].keys(), ...maps[1].keys()]);
  return [...keys].sort().map(key => {
    const [oldValue, newValue, localValue] = maps.map(map => map.has(key) ? map.get(key) : null);
    const status = state(oldValue, newValue, localValue);
    return { key, status: status === 'both-changed' ? 'conflict' : status };
  });
}

function validateCheck(check) {
  if (!check || typeof check !== 'object') throw new Error('Mapping checks must be objects.');
  check = { ...check, service: check.service ?? check.serviceName };
  const template = relativePath(check.template);
  if (!template.startsWith('templates/trailbase/')) throw new Error('Kit mappings must point inside templates/trailbase/.');
  const mode = check.mode ?? 'exact';
  if (!MODES.has(mode)) throw new Error('Unsupported mapping mode.');
  if (mode === 'compose-service' && (typeof check.service !== 'string' || !check.service.trim())) throw new Error('compose-service requires a service name.');
  if (check.volumes !== undefined && (!Array.isArray(check.volumes) || check.volumes.some(v => typeof v !== 'string' || !v.trim()))) throw new Error('volumes must contain nonempty names.');
  const single = check.consumer ?? check.candidate;
  const consumers = check.consumers ?? check.candidates ?? (single === undefined ? [] : [single]);
  if (!Array.isArray(consumers) || !consumers.length) throw new Error('Each mapping needs consumer paths.');
  return { ...check, template, mode, consumers: consumers.map(relativePath) };
}

export function buildUpgradePlan({ kitRoot, consumerRoot, from, to = 'HEAD', mapping }) {
  kitRoot = realpathSync(kitRoot);
  consumerRoot = realpathSync(consumerRoot);
  if (typeof from !== 'string' || !from || typeof to !== 'string' || !to) throw new Error('An explicit --from commit is required.');
  const base = git(kitRoot, ['rev-parse', '--verify', '--end-of-options', `${from}^{commit}`]).stdout.trim();
  const target = git(kitRoot, ['rev-parse', '--verify', '--end-of-options', `${to}^{commit}`]).stdout.trim();
  git(kitRoot, ['merge-base', '--is-ancestor', base, target]);
  if (!Array.isArray(mapping?.checks) || !mapping.checks.length) throw new Error('Mapping needs a nonempty checks array.');
  const checks = mapping.checks.map(validateCheck);
  const files = [];
  for (const check of checks) {
    const oldFile = kitFile(kitRoot, base, check.template);
    const newFile = kitFile(kitRoot, target, check.template);
    const oldText = oldFile?.text ?? null;
    const newText = newFile?.text ?? null;
    if (oldText === null && newText === null) throw new Error('Mapped template is absent from both kit commits.');
    const components = check.mode === 'compose-service' ? [
      { section: 'services', name: check.service },
      ...(check.volumes ?? []).map(name => ({ section: 'volumes', name })),
    ] : [null];
    for (const consumer of check.consumers) for (const component of components) {
      const localFile = consumerFile(consumerRoot, consumer);
      const localText = localFile?.text ?? null;
      const [oldScope, newScope, localScope] = [oldText, newText, localText].map(value => scope(value, check, component));
      if (component && oldScope === null && newScope === null) throw new Error('Mapped Compose entry is absent from both kit commits.');
      let status = state(oldScope, newScope, localScope);
      let details;
      if (check.mode === 'env-subset') {
        const envKeys = compareEnv(oldText, newText, localText);
        if (envKeys.some(key => key.status === 'conflict')) status = 'conflict';
        else if (envKeys.some(key => key.status === 'missing-consumer')) status = 'missing-consumer';
        else if (envKeys.some(key => ['update-required', 'kit-removed'].includes(key.status))) status = 'update-required';
        else if (oldText !== newText && envKeys.some(key => key.status === 'already-applied')) status = 'already-applied';
        else status = envKeys.some(key => key.status === 'consumer-only') ? 'consumer-only' : 'unchanged';
        // A missing/deleted file is meaningful even when it had no active keys.
        if ([oldText, newText, localText].some(value => value === null)) status = state(oldText, newText, localText);
        if (status === 'both-changed') status = 'conflict';
        details = { envKeys };
      } else {
        const lines = compareLines(oldScope, newScope, localScope);
        if (status === 'both-changed') status = lines.mergeable ? 'mergeable-update' : 'conflict';
        details = { kitHunks: lines.kitHunks, consumerHunks: lines.consumerHunks };
      }
      let permissions;
      if (check.mode === 'exact') {
        const [oldExecutable, newExecutable, consumerExecutable] = [oldFile, newFile, localFile].map(file => file?.executable ?? null);
        const permissionStatus = state(oldExecutable, newExecutable, consumerExecutable);
        permissions = { oldExecutable, newExecutable, consumerExecutable, status: permissionStatus };
        status = combinedState(status, permissionStatus);
      }
      const kitChanged = oldScope !== newScope || Boolean(permissions && permissions.oldExecutable !== permissions.newExecutable);
      const migration = check.template.endsWith('.sql') && kitChanged && status !== 'already-applied';
      files.push({ template: check.template, consumer, mode: check.mode, ...(component ? { scope: component } : {}), status, kitChanged,
        consumerChanged: oldScope !== localScope || Boolean(permissions && permissions.oldExecutable !== permissions.consumerExecutable),
        ...details, ...(permissions ? { permissions } : {}),
        action: migration ? 'Review a new consumer-owned forward migration; do not overwrite historical SQL.' :
          ['update-required', 'mergeable-update'].includes(status) ? 'Review kit changes and preserve consumer customization.' :
            ['conflict', 'kit-removed', 'missing-consumer'].includes(status) ? 'Manual reconciliation required; do not delete or overwrite automatically.' : 'No kit update to apply.',
        requiresMigrationReview: migration });
    }
  }
  const changedTemplates = git(kitRoot, ['diff', '--name-only', '-z', '--no-renames', base, target, '--', 'templates/trailbase/']).stdout.split('\0').filter(Boolean);
  const mapped = new Set(checks.map(check => check.template));
  const unmappedTemplates = changedTemplates.filter(path => !mapped.has(path)).map(template => ({
    template, action: template.endsWith('.sql') ? 'Review applicability and create an app-owned migration if needed.' : 'Review applicability and add an explicit mapping if consumed.',
  }));
  const requiresReview = files.some(file => !['unchanged', 'consumer-only', 'already-applied'].includes(file.status) || file.requiresMigrationReview) || unmappedTemplates.length > 0;
  return { schemaVersion: 1, from: base, to: target, readOnly: true, requiresReview, files, unmappedTemplates,
    validation: [
      { scope: 'kit', argv: ['bun', 'run', 'trailbase:functional-ledgers:smoke'] },
      { scope: 'consumer', action: 'Run the app-owned release doctor, migration tests, auth/ACL and feature smoke checks for each adopted change.' },
    ] };
}

export function renderUpgradePlan(plan) {
  const lines = [`Consumer upgrade plan: ${plan.from} -> ${plan.to}`, 'Read-only; no consumer files, migrations, or deployments are changed.', ''];
  for (const file of plan.files) {
    lines.push(`${file.status}: ${file.consumer}${file.scope ? ` [${file.scope.section}.${file.scope.name}]` : ''}`, `  kit: ${file.template}`, `  ${file.action}`);
    if (file.envKeys) for (const key of file.envKeys) lines.push(`  env ${key.key}: ${key.status}`);
    else for (const side of ['kitHunks', 'consumerHunks']) for (const h of file[side]) lines.push(`  ${side}: old ${h.baseStart}+${h.baseLines} -> new ${h.changedStart}+${h.changedLines}`);
    if (file.permissions) lines.push(`  executable: ${file.permissions.oldExecutable} -> ${file.permissions.newExecutable}; consumer ${file.permissions.consumerExecutable} (${file.permissions.status})`);
  }
  for (const file of plan.unmappedTemplates) lines.push(`unmapped: ${file.template}`, `  ${file.action}`);
  lines.push('', 'Validation:', ...plan.validation.map(item => `  ${item.scope}: ${item.argv?.join(' ') ?? item.action}`));
  return lines.join('\n');
}
