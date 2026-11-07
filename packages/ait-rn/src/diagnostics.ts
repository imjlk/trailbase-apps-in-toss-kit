import { defaultFrameworkFunction } from './internal/framework';
import { collectRuntimeDiagnostics, type CollectAppsInTossRuntimeDiagnosticsOptions } from '@trailbase-apps-in-toss-kit/ait-core/internal/runtime';

export type {
  AppsInTossRuntimeDiagnosticProbe,
  AppsInTossRuntimeDiagnosticProbes,
  CollectAppsInTossRuntimeDiagnosticsOptions,
} from '@trailbase-apps-in-toss-kit/ait-core/internal/runtime';

async function frameworkValue(key: 'getOperationalEnvironment' | 'getPlatformOS' | 'getTossAppVersion' | 'getNetworkStatus') {
  const read = await defaultFrameworkFunction(key);
  return read?.();
}
/** Explicit read-only snapshot. It never invokes login, ads, consent or purchases. */
export async function collectAppsInTossRuntimeDiagnostics(options: CollectAppsInTossRuntimeDiagnosticsOptions = {}) {
  return collectRuntimeDiagnostics(options, () => ({
    environment: () => frameworkValue('getOperationalEnvironment'), platform: () => frameworkValue('getPlatformOS'),
    appVersion: () => frameworkValue('getTossAppVersion'), network: () => frameworkValue('getNetworkStatus'),
  }));
}
