import {
  createProxyCapabilitiesCheck,
  evaluateProxyCapabilities,
} from '@trailbase-apps-in-toss-kit/trailbase-runtime/proxy-capabilities';

// Resolve the public package export with no ambient consumer shim or source alias.
const health: unknown = JSON.parse('{"ok":false}');
const result = evaluateProxyCapabilities(health, {
  expectedMode: 'stub',
  minimumVersion: '0.8.0',
  requiredCapabilities: ['anonymous-key.verify'] as const,
});
if (result.ok) {
  const message: string = result.message;
  void message;
  // @ts-expect-error Success has no failure list.
  result.failures;
} else {
  const failures: string[] = result.failures;
  void failures;
  // @ts-expect-error Failure has no success message.
  result.message;
}

const check = createProxyCapabilitiesCheck({
  name: 'Local proxy',
  url: new URL('http://127.0.0.1:8787'),
  tokenEnv: 'DEMO_PROXY_TOKEN',
  env: { DEMO_PROXY_TOKEN: undefined },
  required: false,
  timeout: 1000,
  fetchImpl: async (url, init) => {
    const requestUrl: URL = url;
    const requestInit: RequestInit = init;
    void requestUrl; void requestInit;
    return Response.json({ ok: false });
  },
});
const name: string = check.name;
const required: boolean = check.required;
void name; void required;
const pending = check.run();
pending.then(result => { if (!result.ok) result.failures.map(value => value.toUpperCase()); });
createProxyCapabilitiesCheck({ fetchImpl: globalThis.fetch });
createProxyCapabilitiesCheck();

// @ts-expect-error Mode must match the runtime's supported values.
evaluateProxyCapabilities(health, { expectedMode: 'production' });
// @ts-expect-error Capability names must be strings.
evaluateProxyCapabilities(health, { requiredCapabilities: [123] });
// @ts-expect-error Tokens must be strings.
createProxyCapabilitiesCheck({ token: 123 });
// @ts-expect-error Injected fetch must return a Response.
createProxyCapabilitiesCheck({ fetchImpl: async () => 'not a response' });
