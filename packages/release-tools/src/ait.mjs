import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { AppsInTossBundle } from '@apps-in-toss/ait-format';
import { releaseTag } from './sampo.mjs';

export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
export const buildConfigDigest = (config) => sha256(JSON.stringify(Object.fromEntries(Object.entries(config).sort(([a], [b]) => a.localeCompare(b)))));
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function validatePublicBuildConfig(value, { allowedKeys, constants = {}, httpsKeys = [], adKeys = [], optionalAdKeys = [] }) {
  assert(value && typeof value === 'object' && !Array.isArray(value), 'Build configuration must be an object');
  for (const [key, item] of Object.entries(value)) {
    assert(allowedKeys.includes(key) && typeof item === 'string' && !/[\r\n\0]/.test(item), `Unsupported public build setting: ${key}`);
  }
  const config = Object.fromEntries(Object.entries(value).map(([key, item]) => [key, item.trim()]));
  for (const [key, expected] of Object.entries(constants)) assert.equal(config[key], expected, `Invalid release setting: ${key}`);
  for (const key of httpsKeys) {
    assert(config[key] && !/TODO_|example\./i.test(config[key]), `Missing production URL: ${key}`);
    const url = new URL(config[key]);
    assert(url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash, `Public HTTPS origin required: ${key}`);
  }
  for (const key of [...adKeys, ...optionalAdKeys.filter((key) => config[key])]) {
    assert(config[key] && !/TODO_|example\.|ait-ad-test-/i.test(config[key]), `Issued ad group required: ${key}`);
  }
  return config;
}

export function validateUploadRun({ eventName, ref = '', uploadRequested = false, fixture = false }) {
  const upload = eventName === 'push' || uploadRequested;
  if (upload) {
    assert(ref.startsWith('refs/tags/'), 'Workflow upload requires a tag ref');
    assert(!fixture, 'A fixture run cannot upload');
  }
  return upload;
}

export function readReleaseContext({ root, appName, version, requireTag = false, ref = process.env.GITHUB_REF ?? '' }) {
  const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const expected = releaseTag(appName, version);
  const tag = ref.startsWith('refs/tags/') ? ref.slice(10) : git(['tag', '--points-at', 'HEAD']).split('\n').find((value) => value === expected) ?? null;
  if (tag) assert.equal(tag, expected, 'Tag must match app name and lockstep version');
  if (requireTag) {
    assert(tag, 'Upload requires a release tag at HEAD');
    assert.equal(git(['rev-parse', `${tag}^{commit}`]), git(['rev-parse', 'HEAD']), 'Tag points at another commit');
    git(['merge-base', '--is-ancestor', 'HEAD', 'origin/main']);
  }
  return { appName, version, tag, commit: git(['rev-parse', 'HEAD']), dirty: Boolean(git(['status', '--porcelain'])) };
}

/**
 * Inspect an AIT before upload. React Native artifacts list their exact
 * platform/runtime bundles (`expectedBundles`); WebView SDK 3 artifacts pass
 * `webview` instead, since a web build names its chunks by content hash.
 */
export async function inspectAitArtifact(buffer, policy) {
  return policy.webview ? inspectWebViewArtifact(buffer, policy) : inspectReactNativeArtifact(buffer, policy);
}

async function inspectReactNativeArtifact(buffer, { appName, expectedBundles, config, settingKeys, maxUnpackedBytes = 100_000_000 }) {
  assert(Array.isArray(expectedBundles) && expectedBundles.length > 0, 'Expected RN bundles must be explicit');
  assert.equal(AppsInTossBundle.detect(buffer), AppsInTossBundle.Format.AIT, 'Expected current AIT format');
  const reader = AppsInTossBundle.reader(buffer);
  assert.equal(reader.appName, appName, 'Bundle belongs to a different app');
  const entries = reader.listEntries();
  assert.deepEqual(entries.filter((entry) => entry.endsWith('.js')).sort(), [...expectedBundles].sort(), 'Unexpected platform/runtime bundles');
  let unpackedBytes = 0;
  for (const entry of entries) {
    const bytes = await reader.readEntry(entry);
    unpackedBytes += bytes.byteLength;
    assert(unpackedBytes <= maxUnpackedBytes, 'Unpacked AIT exceeds the configured size limit');
    if (!/\.(js|map|json|html|txt)$/.test(entry)) continue;
    const text = new TextDecoder().decode(bytes);
    assert(!text.includes('ait-ad-test-'), `Test ad ID found in ${entry}`);
    if (!entry.endsWith('.js')) continue;
    assert(entries.includes(`${entry}.map`), `Missing source map: ${entry}`);
    for (const key of settingKeys) {
      assert(typeof config[key] === 'string', `Missing expected bundle setting: ${key}`);
      assert(new RegExp(`(?:["']${escapeRegex(key)}["']|\\b${escapeRegex(key)})\\s*:\\s*["']${escapeRegex(config[key])}["']`).test(text), `Packaged setting differs: ${key} in ${entry}`);
    }
  }
  return { appName: reader.appName, deploymentId: reader.deploymentId, bytes: buffer.byteLength, unpackedBytes, sha256: sha256(buffer), bundles: [...expectedBundles] };
}

// Minifiers may quote string values with backticks (`KEY:`value``).
const QUOTES = `"'\``;

const SIMPLE_ESCAPES = { b: '\b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v', 0: '\0', '\n': '', '\r': '' };

/** The runtime value of a JS string literal's body: escapes resolved. */
function decodeJsString(raw) {
  return raw.replace(/\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|[\s\S])/g, (_, escape) => {
    if (escape[0] === 'u' && escape.length > 1) {
      return String.fromCodePoint(Number.parseInt(escape[1] === '{' ? escape.slice(2, -1) : escape.slice(1), 16));
    }
    if (escape[0] === 'x' && escape.length === 3) return String.fromCharCode(Number.parseInt(escape.slice(1), 16));
    return SIMPLE_ESCAPES[escape] ?? escape;
  });
}

/** Every `KEY: <quoted value>` in a script, in any quote style, as runtime strings. */
function packagedValues(text, key) {
  const pattern = new RegExp(`(?:[${QUOTES}]${escapeRegex(key)}[${QUOTES}]|\\b${escapeRegex(key)})\\s*:\\s*([${QUOTES}])((?:(?!\\1)[^\\\\]|\\\\[\\s\\S])*)\\1`, 'g');
  return [...text.matchAll(pattern)].map((match) => decodeJsString(match[2]));
}

async function inspectWebViewArtifact(buffer, { appName, webview, config, settingKeys, maxUnpackedBytes = 100_000_000 }) {
  const { entry = 'sources/index.html', requireSourceMaps = false } = webview === true ? {} : webview;
  assert.equal(AppsInTossBundle.detect(buffer), AppsInTossBundle.Format.AIT, 'Expected current AIT format');
  const reader = AppsInTossBundle.reader(buffer);
  assert.equal(reader.appName, appName, 'Bundle belongs to a different app');
  const entries = reader.listEntries();
  assert(entries.includes(entry), `Missing WebView entry: ${entry}`);
  assert(!entries.some((name) => /^bundle\.(ios|android)\./.test(name)), 'React Native bundles found in a WebView artifact');
  const scripts = entries.filter((name) => name.startsWith('sources/') && name.endsWith('.js')).sort();
  assert(scripts.length > 0, 'WebView artifact has no scripts');
  const found = new Map(settingKeys.map((key) => [key, new Set()]));
  let unpackedBytes = 0;
  for (const name of entries) {
    const bytes = await reader.readEntry(name);
    unpackedBytes += bytes.byteLength;
    assert(unpackedBytes <= maxUnpackedBytes, 'Unpacked AIT exceeds the configured size limit');
    if (!/\.(js|map|json|html|css|txt)$/.test(name)) continue;
    const text = new TextDecoder().decode(bytes);
    assert(!text.includes('ait-ad-test-'), `Test ad ID found in ${name}`);
    if (!scripts.includes(name)) continue;
    if (requireSourceMaps) assert(entries.includes(`${name}.map`), `Missing source map: ${name}`);
    for (const key of settingKeys) for (const value of packagedValues(text, key)) found.get(key).add(value);
  }
  // A web build inlines its settings once, in whichever chunk reads them.
  for (const key of settingKeys) {
    assert(typeof config[key] === 'string', `Missing expected bundle setting: ${key}`);
    const values = [...found.get(key)];
    assert(values.length > 0, `Missing packaged setting: ${key}`);
    assert(values.every((value) => value === config[key]), `Packaged setting differs: ${key}`);
  }
  return { appName: reader.appName, deploymentId: reader.deploymentId, bytes: buffer.byteLength, unpackedBytes, sha256: sha256(buffer), bundles: scripts };
}

export function validateReleaseEvidence(report, context, artifact, configHash) {
  assert(report.fixture === false && report.dirty === false && context.dirty === false, 'Only a clean production build may be uploaded');
  assert.equal(report.uploaded, false, 'This build has already been uploaded');
  assert(context.tag, 'Upload context must include a release tag');
  assert.equal(context.tag, releaseTag(context.appName, context.version), 'Upload tag differs from release version');
  assert(/^[a-f0-9]{40}$/.test(context.commit), 'Expected a complete source commit');
  for (const key of ['appName', 'commit', 'version', 'tag']) assert.equal(report[key], context[key], `Build evidence differs: ${key}`);
  for (const key of ['appName', 'sha256', 'deploymentId']) assert.equal(report[key], artifact[key], `Artifact evidence differs: ${key}`);
  assert.equal(report.configHash, configHash, 'Build configuration changed');
}

export function uploadFailureMessage(error) {
  const output = `${error.stdout ?? ''}\n${error.stderr ?? ''}`;
  if (error.code === 'ETIMEDOUT' || /timed?\s*out|timeout/i.test(output)) return 'AIT upload timed out. Check the console deployment before retrying.';
  if (/\b40[13]\b|unauthori[sz]ed|forbidden|unauthenticated/i.test(output)) return 'AIT upload authentication/permission rejected. Check API-key app access.';
  if (/ENOTFOUND|ECONNRESET|ECONNREFUSED|EAI_AGAIN|network/i.test(output)) return 'AIT upload network error. Check the console before retrying.';
  return `AIT upload failed (CLI exit ${Number.isInteger(error.status) ? error.status : 'unknown'}). Check the console before retrying.`;
}

export async function uploadVerifiedAit({ artifactPath, report, context, policy, cliPath, appRoot, apiKey, env = process.env }) {
  assert(typeof apiKey === 'string' && apiKey.trim(), 'AIT_API_KEY is missing');
  const artifact = await inspectAitArtifact(readFileSync(artifactPath), policy);
  validateReleaseEvidence(report, context, artifact, buildConfigDigest(policy.config));
  const expected = `intoss-private://${context.appName}?_deploymentId=${artifact.deploymentId}`;
  let result;
  try {
    const script = /\.(?:mjs|cjs|js)$/i.test(cliPath);
    result = execFileSync(script ? process.execPath : cliPath, [...(script ? [cliPath] : []), 'deploy', '--location', artifactPath, '--api-key', apiKey.trim(), '--profile', `release-${randomUUID()}`, '--scheme-only', '--memo', `${context.tag} (${context.commit.slice(0, 12)})`], {
      cwd: appRoot, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 360_000,
    });
  } catch (error) {
    // Child errors can include secret argv and CLI output. Return static diagnostics only.
    throw new Error(uploadFailureMessage(error));
  }
  assert(result.trim() === expected, 'Uploader returned an unexpected deployment scheme');
  return { ...report, uploaded: true, testScheme: expected };
}
