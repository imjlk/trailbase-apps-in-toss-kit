import { afterEach, expect, test } from 'bun:test';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppsInTossBundle } from '@apps-in-toss/ait-format';
import { buildConfigDigest, inspectAitArtifact, uploadVerifiedAit, validatePublicBuildConfig, validateReleaseEvidence, validateUploadRun } from '../src/ait.mjs';

const roots = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const config = { API_URL: 'https://release.invalid', AD_ID: 'issued-ad', DEBUG: 'false' };
const policy = { appName: 'test-app', expectedBundles: ['bundle.ios.0_84_0.js', 'bundle.android.0_84_0.js', 'bundle.ios.0_72_6.js', 'bundle.android.0_72_6.js'], config, settingKeys: Object.keys(config) };
async function bundle({ appName = policy.appName, missing, noMap, replace = {}, extra = '' } = {}) {
  const writer = AppsInTossBundle.writer({ appName }); writer.setMetadata({ runtimeVersion: '0.84.0' });
  for (const name of policy.expectedBundles) {
    if (name === missing) continue;
    writer.addFile(name, new TextEncoder().encode(`const env=${JSON.stringify({ ...config, ...replace })};${extra}`));
    if (name !== noMap) writer.addFile(`${name}.map`, new TextEncoder().encode('{}'));
  }
  return writer.toBuffer();
}
const context = { appName: 'test-app', version: '1.6.5', tag: 'test-app-v1.6.5', commit: 'a'.repeat(40), dirty: false };
const evidence = (artifact) => ({ ...context, ...artifact, configHash: buildConfigDigest(config), fixture: false, uploaded: false });

test('allowlisted public settings reject secrets, test ads, injection, and unsafe URLs', () => {
  const rules = { allowedKeys: Object.keys(config), constants: { DEBUG: 'false' }, httpsKeys: ['API_URL'], adKeys: ['AD_ID'] };
  expect(validatePublicBuildConfig(config, rules)).toEqual(config);
  for (const patch of [{ AIT_API_KEY: 'secret' }, { DEBUG: 'true' }, { AD_ID: 'ait-ad-test-123' }, { API_URL: 'https://u:p@release.invalid' }, { API_URL: 'https://release.invalid\nSECRET=bad' }]) expect(() => validatePublicBuildConfig({ ...config, ...patch }, rules)).toThrow();
  expect(buildConfigDigest({ DEBUG: 'false', AD_ID: 'issued-ad', API_URL: config.API_URL })).toBe(buildConfigDigest(config));
});

test('only tag upload runs can use a production artifact', () => {
  expect(validateUploadRun({ eventName: 'workflow_dispatch' })).toBe(false);
  expect(validateUploadRun({ eventName: 'push', ref: 'refs/tags/test-app-v1.6.5' })).toBe(true);
  expect(() => validateUploadRun({ eventName: 'workflow_dispatch', uploadRequested: true, ref: 'refs/heads/main' })).toThrow();
  expect(() => validateUploadRun({ eventName: 'push', ref: 'refs/tags/test-app-v1.6.5', fixture: true })).toThrow();
});

test('artifact inspection checks both runtimes, actual settings, maps, and expanded size', async () => {
  const result = await inspectAitArtifact(await bundle(), policy);
  expect(result.bundles).toHaveLength(4); expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
  for (const options of [{ appName: 'other-app' }, { missing: policy.expectedBundles[2] }, { noMap: policy.expectedBundles[0] }, { replace: { DEBUG: 'true' } }, { extra: 'const ad="ait-ad-test-banner";' }]) await expect(inspectAitArtifact(await bundle(options), policy)).rejects.toThrow();
  await expect(inspectAitArtifact(await bundle(), { ...policy, maxUnpackedBytes: 10 })).rejects.toThrow('size limit');
});

test('evidence rejects replaced bytes, stale source, fixtures, changed settings, and repeat upload', async () => {
  const artifact = await inspectAitArtifact(await bundle(), policy);
  const report = evidence(artifact);
  validateReleaseEvidence(report, context, artifact, buildConfigDigest(config));
  for (const patch of [{ fixture: true }, { dirty: true }, { uploaded: true }, { sha256: 'changed' }, { commit: 'b'.repeat(40) }, { tag: 'test-app-v1.6.4' }, { configHash: 'changed' }]) expect(() => validateReleaseEvidence({ ...report, ...patch }, context, artifact, buildConfigDigest(config))).toThrow();
});

test('uploader uses the verified artifact and never exposes CLI credentials or output on failure', async () => {
  const root = mkdtempSync(join(tmpdir(), 'kit-ait-')); roots.push(root);
  const artifactPath = join(root, 'test-app.ait'); const cliPath = join(root, 'fake-ait');
  const bytes = await bundle(); writeFileSync(artifactPath, bytes);
  const artifact = await inspectAitArtifact(bytes, policy); const report = evidence(artifact);
  const apiKey = 'sensitive-test-token';
  const args = { artifactPath, report, context, policy, cliPath, appRoot: root, apiKey };
  const fake = (text) => { writeFileSync(cliPath, `#!/bin/sh\n${text}\n`); chmodSync(cliPath, 0o755); };
  fake('echo "$*" >&2; echo "403 Forbidden" >&2; exit 1');
  try { await uploadVerifiedAit(args); throw new Error('expected failure'); } catch (error) {
    expect(error.message).toContain('authentication/permission'); expect(error.message).not.toContain(apiKey); expect(error.message).not.toContain('--api-key');
  }
  fake('echo "$*"; exit 0');
  try { await uploadVerifiedAit(args); throw new Error('expected failure'); } catch (error) {
    expect(String(error)).toContain('unexpected deployment scheme'); expect(String(error)).not.toContain(apiKey);
  }
  const scheme = `intoss-private://test-app?_deploymentId=${artifact.deploymentId}`;
  fake(`test "$1" = deploy && test "$2" = --location && test "$3" = '${artifactPath}' || exit 1\nprintf '%s\\n' '${scheme}'`);
  expect((await uploadVerifiedAit(args)).testScheme).toBe(scheme);
});
