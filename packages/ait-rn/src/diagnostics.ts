import { defaultFrameworkFunction } from './internal/framework';
import { normalizeNetworkAvailability } from './engagement';

type ProbeResult = { state: 'available' | 'unknown' | 'failed' | 'timeout'; value: unknown };
async function frameworkValue(key: 'getOperationalEnvironment' | 'getPlatformOS' | 'getTossAppVersion' | 'getNetworkStatus') {
  const read = await defaultFrameworkFunction(key);
  return read?.();
}
/** Explicit read-only snapshot. It never invokes login, ads, consent or purchases. */
export async function collectAppsInTossRuntimeDiagnostics({ enabled = false, timeoutMs = 3_000,
  probes = { environment: () => frameworkValue('getOperationalEnvironment'), platform: () => frameworkValue('getPlatformOS'),
    appVersion: () => frameworkValue('getTossAppVersion'), network: () => frameworkValue('getNetworkStatus') },
}: { enabled?: boolean; timeoutMs?: number; probes?: Record<'environment' | 'platform' | 'appVersion' | 'network', () => unknown> } = {}) {
  if (!enabled) return null;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10_000) throw new TypeError('Invalid diagnostic timeout');
  async function read(probe: () => unknown): Promise<ProbeResult> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        Promise.resolve().then(probe).then(value => ({ state: 'available' as const, value }), () => ({ state: 'failed' as const, value: null })),
        new Promise<ProbeResult>(resolve => { timer = setTimeout(() => resolve({ state: 'timeout', value: null }), timeoutMs); }),
      ]);
    } finally { clearTimeout(timer); }
  }
  const keys = ['environment', 'platform', 'appVersion', 'network'] as const;
  const values = await Promise.all(keys.map(key => read(probes[key])));
  const [environment,platform,appVersion,network] = values;
  const normalized = {
    environment: ['sandbox','toss'].includes(environment!.value as string) ? environment!.value as 'sandbox'|'toss' : 'unknown',
    platform: ['ios','android'].includes(platform!.value as string) ? platform!.value as 'ios'|'android' : 'unknown',
    appVersion: typeof appVersion!.value === 'string' && /^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(appVersion!.value) ? appVersion!.value : null,
    network: normalizeNetworkAvailability(network!.value),
  };
  return { schema:'ait-runtime-diagnostics-v1' as const, ...normalized,
    probes:Object.fromEntries(keys.map((key,index) => [key,
      values[index]!.state === 'available' && (normalized[key] === 'unknown' || normalized[key] === null) ? 'unknown' : values[index]!.state])),
    deviceFeaturesVerified:false as const };
}
