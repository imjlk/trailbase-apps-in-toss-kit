import { normalizeNetworkAvailability } from "../engagement";
import type {
  AppsInTossMinVersionRequirement,
  AppsInTossOperationalEnvironment,
  AppsInTossPlatformOS,
} from "../runtime";

// Probe normalizers shared by the RN and WebView runtime helpers. Each adapter
// resolves its own SDK reader and passes it in; these never acquire an SDK.

/** @internal */
export function readOperationalEnvironment(read: () => unknown): AppsInTossOperationalEnvironment {
  try {
    const result = read();
    return result === "sandbox" || result === "toss" ? result : "unknown";
  } catch {
    return "unknown";
  }
}

/** @internal */
export function readPlatformOS(read: () => unknown): AppsInTossPlatformOS {
  try {
    const result = read();
    return result === "android" || result === "ios" ? result : "unknown";
  } catch {
    return "unknown";
  }
}

/** @internal */
export function readAppVersion(read: () => unknown): string | null {
  try {
    const result = read();
    return typeof result === "string" && result.trim() ? result.trim() : null;
  } catch {
    return null;
  }
}

/** @internal A missing, throwing or non-boolean check is unsupported. */
export function readMinVersionSupported(
  check: ((minVersions: { android: AppsInTossMinVersionRequirement; ios: AppsInTossMinVersionRequirement }) => unknown) | undefined,
  minAndroid: AppsInTossMinVersionRequirement,
  minIos: AppsInTossMinVersionRequirement,
): boolean {
  if (typeof check !== "function") return false;
  try {
    return check({ android: minAndroid, ios: minIos }) === true;
  } catch {
    return false;
  }
}

/** @internal A missing or stalled optional native probe must not block read refreshes. */
export async function readNetworkStatusWithin(
  read: () => unknown,
  timeoutMs: number,
): Promise<unknown> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) return "UNKNOWN";
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(read),
      new Promise((resolve) => { timer = setTimeout(() => resolve("UNKNOWN"), timeoutMs); }),
    ]);
  } catch {
    return "UNKNOWN";
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export type AppsInTossRuntimeDiagnosticProbe = "environment" | "platform" | "appVersion" | "network";
export type AppsInTossRuntimeDiagnosticProbes = Record<AppsInTossRuntimeDiagnosticProbe, () => unknown>;
export interface CollectAppsInTossRuntimeDiagnosticsOptions {
  enabled?: boolean;
  timeoutMs?: number;
  probes?: AppsInTossRuntimeDiagnosticProbes;
}

type ProbeResult = { state: "available" | "unknown" | "failed" | "timeout"; value: unknown };

/**
 * @internal Explicit read-only snapshot. It never invokes login, ads, consent
 * or purchases, and reports only normalized values, never raw probe output.
 */
export async function collectRuntimeDiagnostics(
  { enabled = false, timeoutMs = 3_000, probes }: CollectAppsInTossRuntimeDiagnosticsOptions,
  defaultProbes: () => AppsInTossRuntimeDiagnosticProbes,
) {
  if (!enabled) return null;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10_000) throw new TypeError("Invalid diagnostic timeout");
  const resolvedProbes = probes ?? defaultProbes();
  async function read(probe: () => unknown): Promise<ProbeResult> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        Promise.resolve().then(probe).then(value => ({ state: "available" as const, value }), () => ({ state: "failed" as const, value: null })),
        new Promise<ProbeResult>(resolve => { timer = setTimeout(() => resolve({ state: "timeout", value: null }), timeoutMs); }),
      ]);
    } finally { clearTimeout(timer); }
  }
  const keys = ["environment", "platform", "appVersion", "network"] as const;
  const values = await Promise.all(keys.map(key => read(resolvedProbes[key])));
  const [environment, platform, appVersion, network] = values;
  const normalized = {
    environment: ["sandbox", "toss"].includes(environment!.value as string) ? environment!.value as "sandbox" | "toss" : "unknown",
    platform: ["ios", "android"].includes(platform!.value as string) ? platform!.value as "ios" | "android" : "unknown",
    appVersion: typeof appVersion!.value === "string" && /^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(appVersion!.value) ? appVersion!.value : null,
    network: normalizeNetworkAvailability(network!.value),
  };
  return {
    schema: "ait-runtime-diagnostics-v1" as const,
    ...normalized,
    probes: Object.fromEntries(keys.map((key, index) => [key,
      values[index]!.state === "available" && (normalized[key] === "unknown" || normalized[key] === null) ? "unknown" : values[index]!.state])),
    deviceFeaturesVerified: false as const,
  };
}
