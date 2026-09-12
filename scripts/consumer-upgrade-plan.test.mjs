import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { buildUpgradePlan, renderUpgradePlan } from './lib/consumer-upgrade-plan.mjs';

const script = resolve(dirname(fileURLToPath(import.meta.url)), 'plan-consumer-upgrade.mjs');
const template = 'templates/trailbase/test.txt';
function write(root, path, value) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  if (value !== null) writeFileSync(join(root, path), value);
}
function git(root, ...args) {
  const result = spawnSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', ...args], { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}
function fixture(oldFiles, newFiles, localFiles, run) {
  const root = mkdtempSync(join(tmpdir(), 'upgrade-plan-test-'));
  const kitRoot = join(root, 'kit'); const consumerRoot = join(root, 'app');
  mkdirSync(kitRoot); mkdirSync(consumerRoot);
  git(kitRoot, 'init', '-q');
  for (const [path, value] of Object.entries(oldFiles)) write(kitRoot, path, value);
  git(kitRoot, 'add', '.'); git(kitRoot, 'commit', '--allow-empty', '-qm', 'base');
  const from = git(kitRoot, 'rev-parse', 'HEAD');
  for (const [path, value] of Object.entries(newFiles)) {
    if (value === null) rmSync(join(kitRoot, path), { force: true });
    else write(kitRoot, path, value);
  }
  git(kitRoot, 'add', '-A'); git(kitRoot, 'commit', '--allow-empty', '-qm', 'next');
  for (const [path, value] of Object.entries(localFiles)) write(consumerRoot, path, value);
  try { run({ kitRoot, consumerRoot, from, to: 'HEAD' }); }
  finally { rmSync(root, { recursive: true, force: true }); }
}
function plan(options, check = {}) {
  return buildUpgradePlan({ ...options, mapping: { checks: [{ template, consumer: 'local.txt', ...check }] } });
}

describe('three-way consumer upgrade planning', () => {
  test('keeps consumer-only customization out of the required kit changes', () => {
    fixture({ [template]: 'base\n' }, {}, { 'local.txt': 'custom\n' }, options => {
      const p = plan(options);
      expect(p.files[0].status).toBe('consumer-only');
      expect(p.requiresReview).toBe(false);
      expect(p.files[0].kitHunks).toEqual([]);
    });
  });

  test('distinguishes independent edits, overlapping edits, and already-applied updates', () => {
    const base = 'a\nb\nc\nd\ne\nf\ng\n';
    const next = 'NEW\nb\nc\nd\ne\nf\ng\n';
    for (const [local, expected] of [[base, 'update-required'], [next, 'already-applied'], ['a\nb\nc\nd\ne\nf\nCUSTOM\n', 'mergeable-update'], ['OTHER\nb\nc\nd\ne\nf\ng\n', 'conflict']]) {
      fixture({ [template]: base }, { [template]: next }, { 'local.txt': local }, options => {
        const p = plan(options);
        expect(p.files[0].status).toBe(expected);
        expect(readFileSync(join(options.consumerRoot, 'local.txt'), 'utf8')).toBe(local);
        expect(git(options.kitRoot, 'status', '--porcelain')).toBe('');
        expect(p.files[0].kitHunks).toEqual([{ baseStart: 1, baseLines: 1, changedStart: 1, changedLines: 1 }]);
      });
    }
  });

  test('represents missing files, additions and deletions without applying them', () => {
    for (const [old, next, local, expected] of [[null, 'new\n', null, 'update-required'], ['old\n', null, 'old\n', 'kit-removed'], ['old\n', null, 'custom\n', 'conflict'], ['same\n', 'same\n', null, 'missing-consumer']]) {
      fixture(old === null ? {} : { [template]: old }, { [template]: next }, local === null ? {} : { 'local.txt': local }, options => {
        const p = plan(options);
        expect(p.files[0].status).toBe(expected);
        expect(p.requiresReview).toBe(true);
      });
    }
  });

  test('scopes Compose changes to the named service and volumes', () => {
    const base = 'services:\n  proxy:\n    image: proxy:1\n    restart: always\nvolumes:\n  certs:\n';
    const next = base.replace('proxy:1', 'proxy:2');
    const local = base.replace('services:\n', 'services:\n  app:\n    image: consumer-only:9\n');
    fixture({ [template]: base }, { [template]: next }, { 'local.txt': local }, options => {
      const p = plan(options, { mode: 'compose-service', service: 'proxy', volumes: ['certs'] });
      expect(p.files[0].status).toBe('update-required');
      expect(p.files[0].consumerHunks).toEqual([]);
      expect(renderUpgradePlan(p)).not.toContain('consumer-only:9');
    });
  });

  test('reports environment keys without leaking values or treating extra app keys as required', () => {
    const base = 'TOKEN=\nMODE=old\nREMOVE=yes\n';
    const next = 'TOKEN=\nMODE=new\nADDED=default\n';
    const local = 'TOKEN=never-print-secret\nMODE=custom\nREMOVE=yes\nAPP_ONLY=other-secret\n';
    fixture({ [template]: base }, { [template]: next }, { 'local.txt': local }, options => {
      const p = plan(options, { mode: 'env-subset' });
      expect(p.files[0].status).toBe('conflict');
      expect(p.files[0].envKeys).toEqual([
        { key: 'ADDED', status: 'update-required' }, { key: 'MODE', status: 'conflict' },
        { key: 'REMOVE', status: 'kit-removed' }, { key: 'TOKEN', status: 'consumer-only' },
      ]);
      for (const output of [JSON.stringify(p), renderUpgradePlan(p)]) {
        expect(output).not.toContain('never-print-secret');
        expect(output).not.toContain('other-secret');
        expect(output).not.toContain('APP_ONLY');
      }
    });
  });

  test('never emits exact-mode consumer content, including secrets embedded in unknown fields', () => {
    fixture({ [template]: 'old\n' }, { [template]: 'new\n' }, { 'local.txt': 'arbitrary-secret-value\n' }, options => {
      expect(JSON.stringify(plan(options))).not.toContain('arbitrary-secret-value');
    });
  });

  test('SQL changes require forward migration review and new unmapped templates remain visible', () => {
    const sql = 'templates/trailbase/sql/old.sql';
    const added = 'templates/trailbase/sql/added.sql';
    fixture({ [sql]: 'CREATE TABLE t(id);\n' }, { [sql]: 'CREATE TABLE t(id, name);\n', [added]: 'CREATE TABLE other(id);\n' }, { 'migration.sql': 'CREATE TABLE t(id);\n' }, options => {
      const p = plan(options, { template: sql, consumer: 'migration.sql' });
      expect(p.files[0].requiresMigrationReview).toBe(true);
      expect(p.files[0].action).toContain('do not overwrite');
      expect(p.unmappedTemplates[0].template).toBe(added);
      expect(p.requiresReview).toBe(true);
    });
  });

  test('rejects invalid refs, traversal, binary inputs and escaping symlinks', () => {
    fixture({ [template]: 'old\n' }, {}, { 'local.txt': 'old\n' }, options => {
      expect(() => plan({ ...options, from: 'missing-ref' })).toThrow();
      expect(() => plan(options, { consumer: '../outside' })).toThrow();
      expect(() => plan(options, { template: 'package.json' })).toThrow();
      writeFileSync(join(options.consumerRoot, 'local.txt'), Buffer.from([0]));
      expect(() => plan(options)).toThrow('Binary');
      rmSync(join(options.consumerRoot, 'local.txt'));
      symlinkSync(join(options.kitRoot, template), join(options.consumerRoot, 'local.txt'));
      expect(() => plan(options)).toThrow('escapes');
    });
  });

  test('CLI distinguishes validation errors and advisory/strict review output', () => {
    const repoRoot = resolve(dirname(script), '..');
    const temp = mkdtempSync(join(tmpdir(), 'upgrade-plan-cli-'));
    const sql = 'templates/trailbase/sql/toss_identities.sql';
    write(temp, 'mapping.json', JSON.stringify({ checks: [{ template: sql, consumer: 'missing.sql' }] }));
    const args = [script, temp, '--from', 'HEAD', '--mapping', 'mapping.json', '--json'];
    try {
      const run = extra => spawnSync(process.execPath, [...args, ...extra], { cwd: repoRoot, encoding: 'utf8' });
      expect(run([]).status).toBe(0);
      expect(JSON.parse(run([]).stdout).files[0].status).toBe('missing-consumer');
      expect(run(['--strict']).status).toBe(1);
      expect(run(['--from', 'invalid-ref']).status).toBe(2);
      expect(run(['--unknown']).status).toBe(2);
    } finally { rmSync(temp, { recursive: true, force: true }); }
  });
});
