import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';

export const isStableVersion = (value) => typeof value === 'string' && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value);
const git = (root, args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const toml = (source) => {
  assert(globalThis.Bun?.TOML?.parse, 'Sampo discovery and lock synchronization require Bun (use bun, not node)');
  return Bun.TOML.parse(source);
};

function trackedFiles(root) {
  return execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean).filter((path) => !path.startsWith('vendor/'));
}

function readTracked(root, path) {
  const resolvedRoot = realpathSync(root);
  const file = realpathSync(resolve(root, path));
  assert(file.startsWith(`${resolvedRoot}${sep}`), `Release input must remain inside the repository: ${path}`);
  return readFileSync(file, 'utf8');
}

// Resolve the fixed group from Sampo itself, so newly added components cannot be
// omitted from a second, app-local list of versioned packages.
export function readSampoLockstep({ root, anchor }) {
  const config = toml(readTracked(root, '.sampo/config.toml'));
  const groups = (config.packages?.fixed ?? []).filter((group) => Array.isArray(group) && group.includes(anchor));
  assert.equal(groups.length, 1, 'Anchor must belong to exactly one Sampo fixed group');
  const wanted = groups[0];
  assert(wanted.length > 0 && new Set(wanted).size === wanted.length, 'Fixed group contains duplicate package IDs');
  const packages = new Map();
  for (const path of trackedFiles(root).filter((path) => /(?:^|\/)(?:package\.json|Cargo\.toml)$/.test(path))) {
    const cargo = path.endsWith('Cargo.toml');
    const manifest = cargo ? toml(readTracked(root, path)).package : JSON.parse(readTracked(root, path));
    if (!manifest?.name) continue;
    const id = `${cargo ? 'cargo' : 'npm'}/${manifest.name}`;
    if (!wanted.includes(id)) continue;
    assert(!packages.has(id), `Multiple tracked manifests declare ${id}`);
    assert(isStableVersion(manifest.version), `Explicit stable package version required: ${path}`);
    packages.set(id, { id, path, name: manifest.name, version: manifest.version, ecosystem: cargo ? 'cargo' : 'npm' });
  }
  for (const id of wanted) assert(packages.has(id), `Sampo package has no tracked manifest: ${id}`);
  const result = wanted.map((id) => packages.get(id));
  const version = result[0].version;
  for (const item of result) assert.equal(item.version, version, `Lockstep version differs: ${item.path}`);
  return { version, packages: result };
}

export function releaseTag(appName, version) {
  assert(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(appName), 'Use the registered lowercase app name');
  assert(isStableVersion(version), 'Stable SemVer is required');
  return `${appName}-v${version}`;
}

export function planSampoRelease({ root, anchor, appName }) {
  const lockstep = readSampoLockstep({ root, anchor });
  const directory = resolve(root, '.sampo/changesets');
  const pending = existsSync(directory) && readdirSync(directory, { withFileTypes: true }).some((entry) => entry.isFile() && entry.name.endsWith('.md'));
  const expected = releaseTag(appName, lockstep.version);
  const exists = git(root, ['tag', '--list', expected]) !== '';
  return { ...lockstep, pending, tag: !pending && !exists ? expected : '' };
}

export function syncCargoLockVersions({ root, anchor }) {
  const lockstep = readSampoLockstep({ root, anchor });
  const crates = new Map(lockstep.packages.filter((item) => item.ecosystem === 'cargo').map((item) => [item.name, item.version]));
  const seen = new Set();
  const writes = [];
  for (const path of trackedFiles(root).filter((path) => /(?:^|\/)Cargo\.lock$/.test(path))) {
    const source = readTracked(root, path);
    const parsed = toml(source);
    const local = new Set();
    const result = source.split(/(?=^\[\[package\]\]\s*$)/m).map((block) => {
      if (!block.startsWith('[[package]]')) return block;
      const item = toml(block).package?.[0];
      if (!item || item.source || !crates.has(item.name)) return block;
      assert(!local.has(item.name), `Ambiguous local package in ${path}: ${item.name}`);
      local.add(item.name); seen.add(item.name);
      // A disambiguated dependency string needs Cargo resolution, not a text edit.
      const referencedVersion = (parsed.package ?? []).some((pkg) => (pkg.dependencies ?? []).some((dep) => dep.startsWith(`${item.name} `)));
      assert(!referencedVersion, `Regenerate ${path} with Cargo: version-qualified dependency ${item.name}`);
      assert(/^version\s*=\s*"[^"]+"\s*$/m.test(block), `Missing lock version: ${item.name}`);
      return block.replace(/^(version\s*=\s*)"[^"]+"/m, `$1"${crates.get(item.name)}"`);
    }).join('');
    if (result !== source) writes.push({ path, text: result });
  }
  for (const name of crates.keys()) assert(seen.has(name), `No tracked Cargo.lock contains local package ${name}`);
  // Validate every lock before changing any file; registry versions/checksums stay intact.
  for (const item of writes) writeFileSync(resolve(root, item.path), item.text);
  return writes.map((item) => item.path);
}

export function createSampoReleaseTag({ root, anchor, appName, push = false }) {
  const plan = planSampoRelease({ root, anchor, appName });
  assert(!plan.pending && plan.tag, 'No new release tag is ready (pending changesets or existing tag)');
  assert.equal(git(root, ['status', '--porcelain']), '', 'Release checkout must be clean');
  assert.equal(git(root, ['rev-parse', 'HEAD']), git(root, ['rev-parse', 'origin/main']), 'Tag only the checked-out main commit');
  git(root, ['tag', '-a', plan.tag, '-m', plan.tag]);
  if (push) execFileSync('git', ['push', 'origin', `refs/tags/${plan.tag}`], { cwd: root, stdio: 'inherit' });
  return plan.tag;
}
