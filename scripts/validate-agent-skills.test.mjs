import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repo = fileURLToPath(new URL('..', import.meta.url));
for (const eol of ['\n', '\r\n']) test(`skill validator accepts ${eol === '\n' ? 'LF' : 'CRLF'} frontmatter and still rejects missing frontmatter`, () => {
  const root = mkdtempSync(path.join(tmpdir(), 'skill-validator-'));
  try {
    mkdirSync(path.join(root, 'scripts'));
    copyFileSync(path.join(repo, 'scripts/validate-agent-skills.mjs'), path.join(root, 'scripts/validate-agent-skills.mjs'));
    cpSync(path.join(repo, 'skills'), path.join(root, 'skills'), { recursive: true });
    function normalize(directory) {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) normalize(file);
        else writeFileSync(file, readFileSync(file, 'utf8').replace(/\r?\n/g, eol));
      }
    }
    normalize(path.join(root, 'skills'));
    const run = () => spawnSync(process.execPath, [path.join(root, 'scripts/validate-agent-skills.mjs')], { encoding: 'utf8' });
    const valid = run();
    assert.equal(valid.status, 0, valid.stderr);
    writeFileSync(path.join(root, 'skills/trailbase-ops/SKILL.md'), 'Missing frontmatter');
    const invalid = run();
    assert.equal(invalid.status, 1);
    assert.match(invalid.stderr, /missing YAML frontmatter/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
