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

export async function inspectAitArtifact(buffer, { appName, expectedBundles, config, settingKeys, maxUnpackedBytes = 100_000_000 }) {
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
    result = execFileSync(cliPath, ['deploy', '--location', artifactPath, '--api-key', apiKey.trim(), '--profile', `release-${randomUUID()}`, '--scheme-only', '--memo', `${context.tag} (${context.commit.slice(0, 12)})`], {
      cwd: appRoot, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 360_000,
    });
  } catch (error) {
    // Child errors can include secret argv and CLI output. Return static diagnostics only.
    throw new Error(uploadFailureMessage(error));
  }
  assert(result.trim() === expected, 'Uploader returned an unexpected deployment scheme');
  return { ...report, uploaded: true, testScheme: expected };
}
