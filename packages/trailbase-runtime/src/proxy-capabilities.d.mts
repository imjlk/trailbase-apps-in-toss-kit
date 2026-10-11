export type ProxyCapabilitiesMode = 'stub' | 'forward';

export interface ProxyCapabilitiesRequirements {
  expectedMode?: ProxyCapabilitiesMode;
  minimumVersion?: string;
  requiredCapabilities?: readonly string[];
}

export type ProxyCapabilitiesResult =
  | { ok: true; message: string }
  | { ok: false; failures: string[] };

/** Only the URL and request init used by the health check are required. */
export type ProxyCapabilitiesFetch = (
  url: URL,
  init: RequestInit,
) => Promise<Response>;

export interface CreateProxyCapabilitiesCheckOptions extends ProxyCapabilitiesRequirements {
  name?: string;
  url?: string | URL;
  token?: string;
  urlEnv?: string;
  tokenEnv?: string;
  env?: Readonly<Record<string, string | undefined>>;
  required?: boolean;
  /** Milliseconds; runtime validation accepts integers from 1 to 60,000. */
  timeout?: number;
  fetchImpl?: ProxyCapabilitiesFetch;
}

export interface ProxyCapabilitiesCheck {
  name: string;
  required: boolean;
  run(): Promise<ProxyCapabilitiesResult>;
}

/** Health responses remain untrusted until evaluated by the runtime validator. */
export function evaluateProxyCapabilities(
  health: unknown,
  requirements?: ProxyCapabilitiesRequirements,
): ProxyCapabilitiesResult;

export function createProxyCapabilitiesCheck(
  options?: CreateProxyCapabilitiesCheckOptions,
): ProxyCapabilitiesCheck;
