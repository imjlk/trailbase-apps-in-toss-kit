import {
  collectRuntimeDiagnostics,
  type CollectAppsInTossRuntimeDiagnosticsOptions as CoreDiagnosticsOptions,
} from "@trailbase-apps-in-toss-kit/ait-core/internal/runtime";
import type { AppsInTossWebRuntimeSdk } from "./runtime";

export type {
  AppsInTossRuntimeDiagnosticProbe,
  AppsInTossRuntimeDiagnosticProbes,
} from "@trailbase-apps-in-toss-kit/ait-core/internal/runtime";

export interface CollectAppsInTossRuntimeDiagnosticsOptions extends CoreDiagnosticsOptions {
  /** Resolve from the consumer's SDK dependency; never acquires the RN SDK. */
  loadSdk?: () => Promise<AppsInTossWebRuntimeSdk>;
}

/**
 * Explicit read-only snapshot with the same schema as RN. It never invokes
 * login, ads, consent or purchases, and is null unless `enabled` is true.
 */
export async function collectAppsInTossRuntimeDiagnostics({
  loadSdk = () => import("@apps-in-toss/web-framework"),
  ...options
}: CollectAppsInTossRuntimeDiagnosticsOptions = {}) {
  return collectRuntimeDiagnostics(options, () => {
    let sdk: Promise<AppsInTossWebRuntimeSdk> | undefined;
    const load = () => sdk ??= loadSdk();
    return {
      environment: async () => (await load()).Environment?.environment,
      platform: async () => (await load()).Device?.os,
      appVersion: async () => (await load()).Environment?.tossAppVersion,
      network: async () => {
        const environment = (await load()).Environment;
        return environment?.getNetworkStatus ? environment.getNetworkStatus() : undefined;
      },
    };
  });
}
