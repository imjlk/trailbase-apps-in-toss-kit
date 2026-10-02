import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { AppsInTossBundle } from '@apps-in-toss/ait-format';

export function inspectAitDeviceMetadata(bytes) {
  assert(AppsInTossBundle.detect(bytes) === AppsInTossBundle.Format.AIT, 'Expected current AIT format');
  const reader = AppsInTossBundle.reader(bytes);
  return {
    appName: reader.appName,
    deploymentId: reader.deploymentId,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

/** Extend an issued console/CLI scheme; never synthesize its host or deployment ID. */
export function createDeviceTestScheme({ scheme, deploymentId, path, query = {}, allowedQueryKeys = [] }) {
  assert(typeof scheme === 'string' && scheme.length <= 8192 && !/[\s\\]/.test(scheme), 'Invalid test scheme');
  const url = new URL(scheme);
  assert(url.protocol === 'intoss-private:' && url.hostname && !url.username && !url.password && !url.port && !url.hash, 'Expected an issued private test scheme');
  const ids = url.searchParams.getAll('_deploymentId');
  assert(ids.length === 1 && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(ids[0]) && ids[0] === deploymentId, 'Deployment ID differs from artifact evidence');
  assert([...url.searchParams.keys()].every(key => key === '_deploymentId' || key === 'queryParams'), 'Unexpected test scheme parameter');
  assert(url.searchParams.getAll('queryParams').length <= 1, 'Duplicate test query');
  if (path !== undefined) {
    assert(typeof path === 'string' && /^\/(?!\/)/.test(path) && path.length <= 1024 && !/[?#\\\s]/.test(path), 'Invalid test path');
    assert(!path.split('/').some(part => { try { const decoded = decodeURIComponent(part); return ['.','..'].includes(decoded) || /[\s\\/\u0000-\u001f\u007f]/.test(decoded); } catch { return true; } }), 'Invalid test path');
    url.pathname = path;
  }
  assert(query && typeof query === 'object' && !Array.isArray(query), 'Invalid test query');
  // Validate an existing query too; accepting an issued scheme must not bypass the allowlist.
  const existingQuery = url.searchParams.get('queryParams');
  if (existingQuery !== null) assert(existingQuery.length <= 4096, 'Test query exceeds size limit');
  const effectiveQuery = Object.keys(query).length ? query : existingQuery === null ? {} : JSON.parse(existingQuery);
  assert(effectiveQuery && typeof effectiveQuery === 'object' && !Array.isArray(effectiveQuery), 'Invalid test query');
  assert(Array.isArray(allowedQueryKeys), 'Invalid query allowlist');
  for (const [key,value] of Object.entries(effectiveQuery)) {
    assert(allowedQueryKeys.includes(key) && !/(?:token|secret|password|authorization|userkey|hmac|sealed)/i.test(key), 'Test query key is not allowed');
    assert(['string','boolean','number'].includes(typeof value) && (typeof value !== 'number' || Number.isFinite(value)), 'Invalid test query value');
  }
  if (Object.keys(effectiveQuery).length) {
    const json=JSON.stringify(effectiveQuery); assert(json.length <= 4096, 'Test query exceeds size limit');
    url.searchParams.set('queryParams',json);
  }
  return url.href;
}

/** This is a test plan, not evidence that any device check was performed. */
export function createDeviceTestPlan({ artifact, scheme, routes = [], allowedQueryKeys = [] }) {
  assert(artifact && /^[a-f0-9]{40}$/.test(artifact.commit) && /^[a-f0-9]{64}$/.test(artifact.sha256), 'Source commit and artifact SHA256 are required');
  assert(typeof artifact.version === 'string' && /^\d+\.\d+\.\d+$/.test(artifact.version), 'Stable app version is required');
  assert(typeof artifact.appName === 'string' && /^[a-z0-9-]{1,64}$/.test(artifact.appName), 'App name is required');
  assert(Array.isArray(routes) && routes.length <= 20, 'Too many test routes');
  const root = createDeviceTestScheme({ scheme, deploymentId:artifact.deploymentId, allowedQueryKeys });
  return { schema:'ait-device-test-plan-v1', appName:artifact.appName, version:artifact.version,
    commit:artifact.commit, sha256:artifact.sha256, deploymentId:artifact.deploymentId,
    checks:[{ name:'entry', scheme:root, status:'not_run' }, ...routes.map(route => {
      assert(typeof route.name === 'string' && /^[a-z0-9-]{1,64}$/.test(route.name),'Invalid test name');
      return { name:route.name, scheme:createDeviceTestScheme({scheme,deploymentId:artifact.deploymentId,path:route.path,query:route.query,allowedQueryKeys}),status:'not_run' };
    })] };
}
