import { parseVersion, compareVersions } from './internal/semver.mjs';

/** Current SDK 1/2 and 3.1.1+ use apps/private-apps; 3.0.x uses web/private-web. */
export function appsInTossWebOrigins({ appName, sdkVersion }) {
  if (typeof appName !== 'string' || !/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(appName)) throw new TypeError('Invalid app name');
  const version = parseVersion(sdkVersion);
  if (!version || version.prerelease.length || version.core[0] < 1 || version.core[0] > 3) throw new TypeError('Provide explicit observed origins for this SDK version');
  const family = version.core[0] === 3 && compareVersions(sdkVersion, '3.1.1') < 0 ? 'web' : 'apps';
  return [`https://${appName}.${family}.tossmini.com`, `https://${appName}.private-${family}.tossmini.com`];
}

function endpointUrl(value, allowLocalHttp) {
  if (typeof value !== 'string' || value.length > 2048 || /[\s\\]/.test(value)) throw new TypeError('Invalid endpoint');
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash ||
      (url.protocol !== 'https:' && !(allowLocalHttp && url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) throw new TypeError('HTTPS endpoint required');
  return url;
}
const tokens = value => (value ?? '').split(',').map(v => v.trim().toLowerCase()).filter(Boolean);

/** Header-only OPTIONS probe. Never posts, authenticates, changes CORS or reads bodies. */
export function createWebViewNetworkCheck({ name = 'WebView API preflight', required = true,
  runtime = 'web', endpoint, appName, sdkVersion, origins,
  method = 'POST', requestHeaders = ['authorization', 'content-type'], credentials = false,
  timeout = 5_000, allowLocalHttp = false, fetcher = globalThis.fetch,
} = {}) {
  return { name, required, async run() {
    if (runtime === 'rn') return { ok: true, skipped: true, message: 'WebView CORS does not establish React Native connectivity' };
    let url; let expected;
    try {
      if (runtime !== 'web' || !Number.isSafeInteger(timeout) || timeout < 1 || timeout > 30_000 ||
          !['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'].includes(method) ||
          !Array.isArray(requestHeaders) || requestHeaders.length > 16 ||
          requestHeaders.some(value => typeof value !== 'string' || !/^[a-z0-9-]{1,64}$/i.test(value))) throw Error();
      url = endpointUrl(endpoint, allowLocalHttp);
      expected = origins ?? appsInTossWebOrigins({ appName, sdkVersion });
      if (!Array.isArray(expected) || expected.length < 1 || expected.length > 4) throw Error();
      expected = expected.map(value => {
        const origin = endpointUrl(value, false);
        if (origin.pathname !== '/') throw Error();
        return origin.origin;
      });
    } catch { return { ok: false, failures: ['Invalid WebView network check configuration'] }; }
    const failures = []; const details = [];
    for (const [index, origin] of expected.entries()) {
      const controller = new AbortController(); let timer; let expired = false;
      const attempt = Promise.resolve().then(() => fetcher(url.href, {
        method: 'OPTIONS', redirect: 'manual', credentials: 'omit', signal: controller.signal,
        headers: { Origin: origin, 'Access-Control-Request-Method': method,
          ...(requestHeaders.length ? { 'Access-Control-Request-Headers': requestHeaders.join(', ') } : {}) },
      })).then(response => {
        try { Promise.resolve(response.body?.cancel()).catch(() => {}); } catch { /* no body read */ }
        return response;
      });
      try {
        const response = await Promise.race([attempt, new Promise((_, reject) => {
          timer = setTimeout(() => { expired = true; controller.abort(); reject(Error()); }, timeout);
        })]);
        const allowedHeaders = tokens(response.headers.get('access-control-allow-headers'));
        const ok = response.status >= 200 && response.status < 300 &&
          response.headers.get('access-control-allow-origin') === origin &&
          tokens(response.headers.get('access-control-allow-methods')).includes(method.toLowerCase()) &&
          requestHeaders.every(header => allowedHeaders.includes(header.toLowerCase())) &&
          (!credentials || response.headers.get('access-control-allow-credentials') === 'true');
        if (!ok) failures.push(`Origin ${index + 1}: preflight headers/status did not satisfy the requested contract`);
        else details.push(`Origin ${index + 1}: preflight passed`);
      } catch { failures.push(`Origin ${index + 1}: ${expired ? 'timeout' : 'transport failure'}`); }
      finally { clearTimeout(timer); }
    }
    return { ok: failures.length === 0, failures, details,
      message: 'Checks preflight headers only; confirm actual API, SDK and device behavior separately' };
  } };
}
