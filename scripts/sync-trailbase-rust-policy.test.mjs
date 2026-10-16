import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const script = fileURLToPath(new URL('./sync-trailbase-rust-policy.mjs', import.meta.url));
const manifests = {
  'Cargo.toml': '[workspace.package]\nedition = "2024"\nrust-version = "1.90.0"\n',
  'crates/trailbase-guest-common/Cargo.toml': '[package]\nedition.workspace = true\nrust-version.workspace = true\n',
  'crates/trailbase-toss-identity/Cargo.toml': '[package]\nedition.workspace = true\nrust-version.workspace = true\n',
  'rust-toolchain.toml': '[toolchain]\nchannel = "1.95.0"\nprofile = "minimal"\ntargets = ["wasm32-wasip2"]\ncomponents = ["rustfmt", "clippy"]\n',
  '.mise.toml': '[tools]\n"rust" = { version = "1.95.0", profile = "minimal", components = "rustfmt,clippy", targets = "wasm32-wasip2" }\n'
};

for (const eol of ['\n', '\r\n']) {
  const label = eol === '\n' ? 'LF' : 'CRLF';
  test(`${label}: check is read-only, rejects real drift, and sync preserves line endings`, t => {
    const root = mkdtempSync(join(tmpdir(), 'kit-rust-policy-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const put = (path, text) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), text.replace(/\n/g, eol)); };
    put('data/upstream/trailbase/version-policy.json', JSON.stringify({ upstreamMinimumRustVersion: '1.90.0', upstreamRustToolchain: '1.95.0' }));
    for (const [path, text] of Object.entries(manifests)) put(path, text);
    execFileSync(process.execPath, [script, '--check'], { cwd: root });
    for (const [path, text] of Object.entries(manifests)) assert.equal(readFileSync(join(root, path), 'utf8'), text.replace(/\n/g, eol));

    // Exercise each transformed file, including generated toolchain content.
    for (const [path, text] of Object.entries(manifests)) {
      const drifted = text.replace(/1\.90\.0/g, '1.89.0').replace(/1\.95\.0/g, '1.94.0').replace('rust-version.workspace = true', 'rust-version.workspace = false');
      put(path, drifted);
      const result = spawnSync(process.execPath, [script, '--check'], { cwd: root, encoding: 'utf8' });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /is not synchronized/);
      assert.equal(readFileSync(join(root, path), 'utf8'), drifted.replace(/\n/g, eol));
      execFileSync(process.execPath, [script], { cwd: root });
      assert.equal(readFileSync(join(root, path), 'utf8'), text.replace(/\n/g, eol));
    }
    execFileSync(process.execPath, [script, '--check'], { cwd: root });
  });
}
