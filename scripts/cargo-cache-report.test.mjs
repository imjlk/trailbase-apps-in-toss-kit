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
