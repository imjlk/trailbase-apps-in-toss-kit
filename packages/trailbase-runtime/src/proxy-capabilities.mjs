import semver from "semver";

const HEALTH_PATH = "/internal/apps-in-toss/health";
const MAX_BODY_BYTES = 16 * 1024;
const CAPABILITY = /^[a-z][a-z0-9.-]{0,63}$/;
const validVersion = value => typeof value === "string" && value.length <= 128 &&
  /^\d/.test(value) && value.trim() === value && semver.valid(value) !== null;
const failure = message => ({ ok: false, failures: [message] });

export function evaluateProxyCapabilities(health, {
  expectedMode = "forward", minimumVersion, requiredCapabilities = [],
} = {}) {
  if (!["stub", "forward"].includes(expectedMode) ||
      (minimumVersion !== undefined && !validVersion(minimumVersion)) ||
      !Array.isArray(requiredCapabilities) || requiredCapabilities.length > 100 ||
      requiredCapabilities.some(value => typeof value !== "string" || !CAPABILITY.test(value))) {
    return failure("Invalid proxy capability requirements");
  }
  if (health?.ok !== true || health.mode !== expectedMode) return failure("Proxy health or mode did not match requirements");
  const kit = health.kit;
  if (kit?.contractVersion !== 1) return failure("Proxy has no supported kit capability contract; upgrade the proxy");
  if (!validVersion(kit.proxyVersion) ||
      !Array.isArray(kit.capabilities) || kit.capabilities.length > 100 ||
      kit.capabilities.some(value => typeof value !== "string" || !CAPABILITY.test(value))) {
    return failure("Proxy capability metadata is invalid");
  }
  if (minimumVersion && !semver.gte(kit.proxyVersion, minimumVersion)) {
    return failure("Proxy version is below the required minimum");
  }
  const missing = requiredCapabilities.filter(value => !kit.capabilities.includes(value));
  if (missing.length) return failure(`Missing proxy capabilities: ${missing.join(", ")}`);
  return { ok: true, message: `Proxy ${kit.proxyVersion} (${expectedMode}) supports the requested adapter contracts` };
}

// Programmatic callers may inject fetch for tests. Config files accept env names only.
export function createProxyCapabilitiesCheck({
  name = "Proxy capabilities", url, token,
  urlEnv = "MTLS_PROXY_URL", tokenEnv = "MTLS_PROXY_TOKEN", env = process.env,
  required = true, expectedMode = "forward", minimumVersion,
  requiredCapabilities = [], timeout = 5000, fetchImpl = globalThis.fetch,
} = {}) {
  return { name, required, async run() {
    let timer;
    let reader;
    const controller = new AbortController();
    try {
      if (![urlEnv, tokenEnv].every(value => typeof value === "string" && /^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) ||
          !Number.isInteger(timeout) || timeout < 1 || timeout > 60_000) return failure("Invalid proxy check configuration");
      const base = new URL(url ?? env[urlEnv]);
      if (!["http:", "https:"].includes(base.protocol) || base.username || base.password || base.search || base.hash ||
          !["", "/"].includes(base.pathname)) return failure("Proxy URL must be an HTTP(S) origin without credentials");
      const credential = token ?? env[tokenEnv];
      if (typeof credential !== "string" || !credential.trim()) return failure("Proxy token is required");
      const work = (async () => {
        const response = await fetchImpl(new URL(HEALTH_PATH, base), {
          method: "GET", headers: { authorization: `Bearer ${credential}`, accept: "application/json" },
          redirect: "error", credentials: "omit", cache: "no-store", signal: controller.signal,
        });
        if (!response.ok || response.redirected) return failure("Proxy health request failed");
        if (!response.body || Number(response.headers.get("content-length")) > MAX_BODY_BYTES) return failure("Proxy health response is invalid or too large");
        reader = response.body.getReader();
        const chunks = []; let size = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > MAX_BODY_BYTES) return failure("Proxy health response is too large");
          chunks.push(value);
        }
        const bytes = new Uint8Array(size); let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
        const health = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
        return evaluateProxyCapabilities(health, { expectedMode, minimumVersion, requiredCapabilities });
      })();
      const deadline = new Promise(resolve => {
        timer = setTimeout(() => { controller.abort(); resolve(failure("Proxy health request timed out")); }, timeout);
      });
      // The race handles late rejections; unconditional cleanup also cancels stalled bodies.
      return await Promise.race([work, deadline]);
    } catch {
      // URLs, tokens, response bodies and transport errors may contain secrets.
      return failure("Proxy capability check failed; verify configuration, connectivity and response format");
    } finally {
      clearTimeout(timer);
      controller.abort();
      if (reader) void reader.cancel().catch(() => {});
    }
  } };
}
