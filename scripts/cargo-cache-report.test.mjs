import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { findTargets, report } from './cargo-cache-report.mjs';
test('finds Cargo markers once, excludes source directories and symlink traversals', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'cargo-report-'));
  try {
    for (const dir of ['app/target','node_modules/target','ordinary/target']) mkdirSync(path.join(root, dir), { recursive: true });
    writeFileSync(path.join(root,'app/target/.rustc_info.json'), '{}');
    writeFileSync(path.join(root,'node_modules/target/.rustc_info.json'), '{}');
    symlinkSync(root, path.join(root,'loop'));
    assert.deepEqual(findTargets([root, path.join(root,'app')]), [path.join(root,'app/target')]);
    assert.equal(report([root])[0].path, path.join(root,'app/target'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('root symlinks never cause scanning outside the requested tree', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'cargo-root-link-'));
  try {
    mkdirSync(path.join(root, 'outside'));
    writeFileSync(path.join(root, 'outside', '.rustc_info.json'), '{}');
    symlinkSync(path.join(root, 'outside'), path.join(root, 'link'));
    assert.deepEqual(findTargets([path.join(root, 'link')]), []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test('missing du and failed measurements give actionable errors instead of secondary exceptions', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'cargo-du-'));
  try {
    writeFileSync(path.join(root, '.rustc_info.json'), '{}');
    assert.throws(() => report([root], () => ({ error: { code: 'ENOENT' }, status: null, stderr: null })), /Unix-compatible du.*ENOENT/);
    assert.throws(() => report([root], () => ({ status: 1, stderr: null })), /du failed/);
    assert.throws(() => report([root], () => ({ status: 0, stdout: 'garbage' })), /Invalid du/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a child replaced with a symlink after enumeration is not followed', async () => {
  const { readdirSync, renameSync } = await import('node:fs');
  const root = mkdtempSync(path.join(tmpdir(), 'cargo-race-'));
  try {
    mkdirSync(path.join(root, 'scan', 'child'), { recursive: true });
    mkdirSync(path.join(root, 'outside'));
    writeFileSync(path.join(root, 'outside', '.rustc_info.json'), '{}');
    const scan = path.join(root, 'scan');
    const readDirectory = (directory, options) => {
      const entries = readdirSync(directory, options);
      if (directory === scan) {
        renameSync(path.join(scan, 'child'), path.join(root, 'old-child'));
        symlinkSync(path.join(root, 'outside'), path.join(scan, 'child'));
      }
      return entries;
    };
    assert.deepEqual(findTargets([scan], { readDirectory }), []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
