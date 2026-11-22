import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppsInTossBundle } from '@apps-in-toss/ait-format';
import { buildConfigDigest, inspectAitArtifact, readUploadedScheme, uploadVerifiedAit, validatePublicBuildConfig, validateReleaseEvidence, validateUploadRun } from '../src/ait.mjs';

const roots = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const config = { API_URL: 'https://release.invalid', AD_ID: 'issued-ad', DEBUG: 'false' };
const policy = { appName: 'test-app', expectedBundles: ['bundle.ios.0_84_0.js', 'bundle.android.0_84_0.js', 'bundle.ios.0_72_6.js', 'bundle.android.0_72_6.js'], config, settingKeys: Object.keys(config) };
async function bundle({ appName = policy.appName, missing, noMap, replace = {}, omit, extra = '' } = {}) {
  const writer = AppsInTossBundle.writer({ appName }); writer.setMetadata({ runtimeVersion: '0.84.0' });
  const env = Object.fromEntries(Object.entries({ ...config, ...replace }).filter(([key]) => key !== omit));
  for (const name of policy.expectedBundles) {
    if (name === missing) continue;
    writer.addFile(name, new TextEncoder().encode(`const env=${JSON.stringify(env)};${extra}`));
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
  // Another identifier ending in the key is not the setting.
  await expect(inspectAitArtifact(await bundle({ omit: 'API_URL', extra: 'const x={$API_URL:"https://release.invalid"};' }), policy)).rejects.toThrow('Packaged setting differs: API_URL');
  await expect(inspectAitArtifact(await bundle(), { ...policy, maxUnpackedBytes: 10 })).rejects.toThrow('size limit');
});

const webPolicy = { appName: 'test-app', webview: true, config, settingKeys: Object.keys(config) };
// A Vite-style build: content-hashed chunks, settings inlined once with backtick quotes.
async function webBundle({ appName = webPolicy.appName, entry = true, rn = false, map = false, replace = {}, omit, extra = '' } = {}) {
  const writer = AppsInTossBundle.writer({ appName });
  const values = Object.entries({ ...config, ...replace }).filter(([key]) => key !== omit);
  if (entry) writer.addFile('sources/index.html', new TextEncoder().encode('<script type="module" src="./assets/index-abc123.js"></script>'));
  writer.addFile('sources/assets/index-abc123.js', new TextEncoder().encode(`function env(e={${values.map(([key, value]) => `${key}:\`${value}\``).join(',')}}){return e}${extra}`));
  writer.addFile('sources/assets/vendor-def456.js', new TextEncoder().encode('export const ui=1;'));
  if (map) for (const chunk of ['index-abc123', 'vendor-def456']) writer.addFile(`sources/assets/${chunk}.js.map`, new TextEncoder().encode('{}'));
  if (rn) writer.addFile('bundle.ios.0_84_0.js', new TextEncoder().encode('rn'));
  return writer.toBuffer();
}

test('WebView inspection finds settings in any chunk and any quote style', async () => {
  const result = await inspectAitArtifact(await webBundle(), webPolicy);
  expect(result.bundles).toEqual(['sources/assets/index-abc123.js', 'sources/assets/vendor-def456.js']);
  expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
  for (const options of [
    { appName: 'other-app' },
    { entry: false },
    { rn: true },
    { replace: { DEBUG: 'true' } },
    { omit: 'AD_ID' },
    { extra: 'const ad="ait-ad-test-banner";' },
    // A second, different value for the same key anywhere in the scripts.
    { extra: `const stale={API_URL:'https://stale.invalid'};` },
  ]) await expect(inspectAitArtifact(await webBundle(options), webPolicy)).rejects.toThrow();
  // Another identifier ending in the key is not the setting.
  await expect(inspectAitArtifact(await webBundle({ omit: 'API_URL', extra: 'const x={$API_URL:"https://release.invalid"};' }), webPolicy)).rejects.toThrow('Missing packaged setting: API_URL');
  await expect(inspectAitArtifact(await webBundle(), { ...webPolicy, webview: { requireSourceMaps: true } })).rejects.toThrow('source map');
  await expect(inspectAitArtifact(await webBundle({ map: true }), { ...webPolicy, webview: { requireSourceMaps: true } })).resolves.toBeDefined();
  await expect(inspectAitArtifact(await webBundle(), { ...webPolicy, maxUnpackedBytes: 10 })).rejects.toThrow('size limit');
});

test('WebView inspection compares settings as runtime strings, escapes resolved', async () => {
  const special = { TITLE: `Bob's "gold" app`, NOTE: 'café ${x}' };
  const policy = { appName: 'test-app', webview: true, config: special, settingKeys: Object.keys(special) };
  const writer = AppsInTossBundle.writer({ appName: 'test-app' });
  writer.addFile('sources/index.html', new TextEncoder().encode('<script></script>'));
  // As a minifier writes them: escaped quotes, a Unicode escape and an escaped interpolation.
  writer.addFile('sources/assets/index-abc123.js', new TextEncoder().encode(String.raw`const e={TITLE:'Bob\'s "gold" app',NOTE:` + '`caf\\u00e9 \\${x}`' + '};'));
  const buffer = await writer.toBuffer();
  await expect(inspectAitArtifact(buffer, policy)).resolves.toBeDefined();
  // The source spelling is not the runtime value.
  await expect(inspectAitArtifact(buffer, { ...policy, config: { ...special, TITLE: String.raw`Bob\'s "gold" app` } })).rejects.toThrow('Packaged setting differs: TITLE');
});

test('evidence rejects replaced bytes, stale source, fixtures, changed settings, and repeat upload', async () => {
  const artifact = await inspectAitArtifact(await bundle(), policy);
  const report = evidence(artifact);
  validateReleaseEvidence(report, context, artifact, buildConfigDigest(config));
  for (const patch of [{ fixture: true }, { dirty: true }, { uploaded: true }, { sha256: 'changed' }, { commit: 'b'.repeat(40) }, { tag: 'test-app-v1.6.4' }, { configHash: 'changed' }]) expect(() => validateReleaseEvidence({ ...report, ...patch }, context, artifact, buildConfigDigest(config))).toThrow();
});

test('uploader uses the verified artifact and never exposes CLI credentials or output on failure', async () => {
  const root = mkdtempSync(join(tmpdir(), 'kit ait 한글 & ')); roots.push(root);
  const artifactPath = join(root, 'test-app.ait'); const cliPath = join(root, 'fake-ait.mjs');
  const bytes = await bundle(); writeFileSync(artifactPath, bytes);
  const artifact = await inspectAitArtifact(bytes, policy); const report = evidence(artifact);
  const apiKey = 'sensitive-test-token & "quoted"';
  const args = { artifactPath, report, context, policy, cliPath, appRoot: root, apiKey };
  const fake = (text) => writeFileSync(cliPath, text);
  fake('console.error(process.argv.slice(2).join(" ")); console.error("403 Forbidden"); process.exit(1);');
  try { await uploadVerifiedAit(args); throw new Error('expected failure'); } catch (error) {
    expect(error.message).toContain('authentication/permission'); expect(error.message).not.toContain(apiKey); expect(error.message).not.toContain('--api-key');
  }
  fake('console.log(process.argv.slice(2).join(" "));');
  try { await uploadVerifiedAit(args); throw new Error('expected failure'); } catch (error) {
    expect(String(error)).toContain('unexpected deployment scheme'); expect(String(error)).not.toContain(apiKey);
  }
  const scheme = `intoss-private://test-app?_deploymentId=${artifact.deploymentId}`;
  fake(`import assert from 'node:assert/strict'; assert.deepEqual(process.argv.slice(2, 7), ['deploy', '--location', ${JSON.stringify(artifactPath)}, '--api-key', ${JSON.stringify(apiKey)}]); console.log(${JSON.stringify(scheme)});`);
  expect((await uploadVerifiedAit(args)).testScheme).toBe(scheme);
  // The WebView SDK 3 CLI (3.10) appends its host marker; that line is the issued scheme.
  const webScheme = `${scheme}&host=appsInTossHost`;
  fake(`console.log(${JSON.stringify(webScheme)});`);
  expect((await uploadVerifiedAit(args)).testScheme).toBe(webScheme);
});

test('an uploaded scheme names this app and deployment, with only the CLI host marker', () => {
  const id = '0198c000-68c3-7d2b-0000-2c00000005ec';
  const base = `intoss-private://test-app?_deploymentId=${id}`;
  for (const issued of [base, `${base}&host=appsInTossHost`, `${base}&host=appsInTossHost\n`]) {
    expect(readUploadedScheme(issued, { appName: 'test-app', deploymentId: id })).toBe(issued.trim());
  }
  for (const other of [
    `${base}&host=evil.invalid`,
    `${base}&host=appsInTossHost&host=appsInTossHost`,
    `${base}&extra=1`,
    `${base}&_deploymentId=${id}`,
    `intoss-private://other-app?_deploymentId=${id}`,
    `intoss-private://test-app?_deploymentId=0198c000-68c3-7d2b-0000-2c00000005ed`,
    `intoss://test-app?_deploymentId=${id}`,
    `intoss-private://test-app/furnace?_deploymentId=${id}`,
    `${base}#fragment`,
    `${base} trailing`,
    'not a scheme',
  ]) expect(() => readUploadedScheme(other, { appName: 'test-app', deploymentId: id })).toThrow('unexpected deployment scheme');
});
