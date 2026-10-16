import { expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { removeIsolatedWorkspaceLinks } from './lib/workspace-install-links.mjs';

test('Windows hoisting removes only old workspace links into this kit isolated store', () => {
  const root = mkdtempSync(join(tmpdir(), 'kit-install-links-'));
  try {
    writeFileSync(join(root, 'package.json'), JSON.stringify({ workspaces: ['packages/*', 'services/*'] }));
    const store = join(root, 'node_modules/.bun/sdk@0.6.0/node_modules/sdk');
    const workspace = join(root, 'packages/web');
    const modules = join(workspace, 'node_modules');
    const custom = join(root, 'custom-package');
    for (const path of [store, join(modules, '@ait-kit'), join(modules, 'real-package'), custom]) mkdirSync(path, { recursive: true });
    writeFileSync(join(workspace, 'package.json'), '{}');
    writeFileSync(join(store, 'marker'), 'keep target');
    writeFileSync(join(modules, 'real-package/marker'), 'keep real directory');
    const type = process.platform === 'win32' ? 'junction' : 'dir';
    symlinkSync(store, join(modules, '@ait-kit/sdk'), type);
    symlinkSync(store, join(modules, 'old-unscoped'), type);
    symlinkSync(custom, join(modules, 'custom-link'), type);
    expect(removeIsolatedWorkspaceLinks({ root, platform: 'linux' })).toEqual([]);
    expect(existsSync(join(modules, '@ait-kit/sdk'))).toBe(true);
    expect(removeIsolatedWorkspaceLinks({ root, platform: 'win32' })).toHaveLength(2);
    expect(existsSync(join(modules, '@ait-kit/sdk'))).toBe(false);
    expect(existsSync(join(modules, 'old-unscoped'))).toBe(false);
    expect(readFileSync(join(store, 'marker'), 'utf8')).toBe('keep target');
    expect(readFileSync(join(modules, 'real-package/marker'), 'utf8')).toBe('keep real directory');
    expect(existsSync(join(modules, 'custom-link'))).toBe(true);
    expect(removeIsolatedWorkspaceLinks({ root, platform: 'win32' })).toEqual([]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
