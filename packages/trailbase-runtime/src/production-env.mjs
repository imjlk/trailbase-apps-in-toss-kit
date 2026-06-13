import { readdirSync } from "node:fs";

const TOSS_CERT_FILE_SUFFIX = "_public.crt";
const TOSS_KEY_FILE_SUFFIX = "_private.key";
const GENERIC_CLIENT_CERT_FILE = "client-cert.pem";
const GENERIC_CLIENT_KEY_FILE = "client-key.pem";

export function parseEnv(raw) {
  const values = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const withoutExport = trimmed.startsWith("export ")
      ? trimmed.slice("export ".length).trim()
      : trimmed;
    const index = withoutExport.indexOf("=");
    if (index < 1) {
      continue;
    }

    const key = withoutExport.slice(0, index).trim();
    let value = withoutExport.slice(index + 1).trim();
    if (
      (value.startsWith("'") && value.endsWith("'")) ||
      (value.startsWith('"') && value.endsWith('"'))
    ) {
      value = value.slice(1, -1);
    } else {
      const commentIndex = value.search(/\s#/);
      if (commentIndex >= 0) {
        value = value.slice(0, commentIndex).trim();
      }
    }
    values[key] = value;
  }
  return values;
}

export function createValidationContext({
  values = {},
  allowPlaceholders = false,
  label = "production env",
} = {}) {
  const failures = [];
  const warnings = [];

  const context = {
    values,
    allowPlaceholders,
    label,
    failures,
    warnings,
    get(key) {
      return values[key] ?? "";
    },
    has(key) {
      return Boolean(values[key]);
    },
    fail(message) {
      failures.push(message);
    },
    warn(message) {
      warnings.push(message);
    },
    required(key, message = `${key} is required`) {
      if (!context.get(key)) {
        context.fail(message);
      }
    },
    equals(key, expected) {
      context.required(key);
      if (context.get(key) && context.get(key) !== expected) {
        context.fail(`${key} must be ${expected}`);
      }
    },
    optionalEquals(key, expected) {
      if (context.get(key) && context.get(key) !== expected) {
        context.fail(`${key} must be ${expected}`);
      }
    },
    oneOfValue(key, value, allowed) {
      if (value && !allowed.includes(value)) {
        context.fail(`${key} must be one of ${allowed.join(", ")}`);
      }
    },
    optionalOneOf(key, allowed) {
      context.oneOfValue(key, context.get(key), allowed);
    },
    requiredOneOf(key, allowed) {
      context.required(key);
      context.optionalOneOf(key, allowed);
    },
    optionalHttps(key) {
      if (context.get(key) && !context.get(key).startsWith("https://")) {
        context.fail(`${key} must start with https://`);
      }
    },
    requiredHttps(key) {
      context.required(key);
      context.optionalHttps(key);
    },
    requiredSecret(key, minLength = 32) {
      context.required(key);
      if (!allowPlaceholders && context.get(key).length < minLength) {
        context.fail(`${key} must be at least ${minLength} characters`);
      }
    },
    optionalSecret(key, minLength = 32) {
      if (!context.get(key) || allowPlaceholders) {
        return;
      }
      if (context.get(key).length < minLength) {
        context.fail(`${key} must be at least ${minLength} characters when set`);
      }
    },
    positiveInteger(key) {
      context.required(key);
      context.optionalPositiveInteger(key);
    },
    optionalPositiveInteger(key) {
      const value = context.get(key);
      if (value && !/^[1-9]\d*$/.test(value)) {
        context.fail(`${key} must be a positive integer`);
      }
    },
    profileEnabled(profile) {
      return context
        .get("COMPOSE_PROFILES")
        .split(",")
        .map((value) => value.trim())
        .includes(profile);
    },
    placeholderGuard() {
      for (const [key, value] of Object.entries(values)) {
        if (!value || allowPlaceholders) {
          continue;
        }
        const lower = String(value).toLowerCase();
        if (/replace-with|change-me|changeme|todo_|placeholder|example\.com|example\.invalid/.test(lower)) {
          context.fail(`${key} still contains a placeholder value`);
        }
        if (key.endsWith("SECRET") && lower.startsWith("dev-")) {
          context.fail(`${key} still contains a dev secret`);
        }
      }
    },
    report({ successMessage } = {}) {
      return {
        ok: failures.length === 0,
        failures: [...failures],
        warnings: [...warnings],
        successMessage:
          successMessage ?? `${label} validation passed${allowPlaceholders ? " (placeholder mode)" : ""}`,
      };
    },
  };

  return context;
}

export function validateProductionEnv({
  values,
  raw,
  allowPlaceholders = false,
  label,
  appEnvKey,
  appEnvValue = "production",
  requiredSecrets = [],
  optionalSecrets = [],
  requiredHttps = [],
  optionalHttps = [],
  positiveIntegers = [],
  mtlsCertificatePairDir,
  rules = [],
} = {}) {
  const context = createValidationContext({
    values: values ?? parseEnv(raw ?? ""),
    allowPlaceholders,
    label,
  });

  applyCommonProductionRules(context, {
    appEnvKey,
    appEnvValue,
    requiredSecrets,
    optionalSecrets,
    requiredHttps,
    optionalHttps,
    positiveIntegers,
    mtlsCertificatePairDir,
  });

  for (const rule of rules) {
    rule(context);
  }

  context.placeholderGuard();
  return context.report();
}

export function applyCommonProductionRules(context, options = {}) {
  const {
    appEnvKey,
    appEnvValue = "production",
    requiredSecrets = [],
    optionalSecrets = [],
    requiredHttps = [],
    optionalHttps = [],
    positiveIntegers = [],
    mtlsCertificatePairDir,
  } = options;

  if (appEnvKey) {
    context.equals(appEnvKey, appEnvValue);
    if (appEnvKey !== "APP_ENV" && context.get("APP_ENV")) {
      context.warn(
        `APP_ENV is set; prefer ${appEnvKey} to avoid build-time framework warnings`,
      );
    }
  }

  for (const [key, minLength = 32] of normalizeKeyRules(requiredSecrets)) {
    context.requiredSecret(key, minLength);
  }
  for (const [key, minLength = 32] of normalizeKeyRules(optionalSecrets)) {
    context.optionalSecret(key, minLength);
  }
  for (const key of requiredHttps) {
    context.requiredHttps(key);
  }
  for (const key of optionalHttps) {
    context.optionalHttps(key);
  }
  for (const key of positiveIntegers) {
    context.positiveInteger(key);
  }

  applyTrailBaseRuntimeRules(context);
  applyMtlsProxyRules(context, { certificatePairDir: mtlsCertificatePairDir });
}

export function applyTrailBaseRuntimeRules(context) {
  if (context.get("TRAILBASE_SYNC_CONFIG") === "true") {
    context.warn("TRAILBASE_SYNC_CONFIG=true will overwrite persisted TrailBase config on restart");
  }

  if (context.get("TRAILBASE_FRESH_START_TOKEN") || context.get("TRAILBASE_FRESH_START_CONFIRM")) {
    if (!context.get("TRAILBASE_FRESH_START_TOKEN")) {
      context.fail("TRAILBASE_FRESH_START_CONFIRM is set without TRAILBASE_FRESH_START_TOKEN");
    }
    if (context.get("TRAILBASE_FRESH_START_CONFIRM") !== "DELETE_TRAILBASE_DATA") {
      context.fail(
        "TRAILBASE_FRESH_START_TOKEN requires TRAILBASE_FRESH_START_CONFIRM=DELETE_TRAILBASE_DATA",
      );
    }
    context.warn("TRAILBASE_FRESH_START_TOKEN will delete TrailBase data once for this token");
  }

  if (context.get("TRAILBASE_BIND") || context.get("PUBLIC_PORT")) {
    context.warn(
      "TRAILBASE_BIND/PUBLIC_PORT are local-only; production compose should route to container port 4000",
    );
  }

  if (context.get("TRAILBASE_DEV_ADMIN_EMAIL") || context.get("TRAILBASE_DEV_ADMIN_PASSWORD")) {
    context.fail("TRAILBASE_DEV_ADMIN_* must not be set in production");
  }
}

export function applyMtlsProxyRules(context, options = {}) {
  const {
    imageKey = "TOSS_MTLS_CLIENT_PROXY_IMAGE",
    proxyUrlKey = "MTLS_PROXY_URL",
    proxyModeKey = "MTLS_PROXY_MODE",
    proxyTokenKey = "MTLS_PROXY_TOKEN",
    upstreamBaseUrlKey = "MTLS_UPSTREAM_BASE_URL",
    clientCertPathKey = "MTLS_CLIENT_CERT_PATH",
    clientKeyPathKey = "MTLS_CLIENT_KEY_PATH",
    requireForwardForInternalProxy = false,
    requireProxyWhen = () => Boolean(context.get(proxyUrlKey)),
    internalServiceName = "toss-mtls-client-proxy",
    certificatePairDir,
    certificatePairLabel = "mTLS certificate directory",
  } = options;

  if (!context.allowPlaceholders && usesMovingProxyImageTag(context.get(imageKey))) {
    context.fail(`${imageKey} must not use latest or edge in production`);
  }

  context.optionalOneOf(proxyModeKey, ["stub", "forward"]);

  const proxyUrl = context.get(proxyUrlKey) || `http://${internalServiceName}:8787`;
  const needsProxy = requireProxyWhen(context);
  if (needsProxy) {
    context.requiredSecret(proxyTokenKey, 32);
    if (proxyUrl.includes(internalServiceName) && !context.allowPlaceholders) {
      if (!context.profileEnabled("toss-proxy")) {
        context.fail(
          `COMPOSE_PROFILES must include toss-proxy when ${proxyUrlKey} points at ${internalServiceName}`,
        );
      }
      if (requireForwardForInternalProxy && context.get(proxyModeKey) !== "forward") {
        context.fail(`${proxyModeKey} must be forward in production when using ${internalServiceName}`);
      }
    }
  }

  if (context.get(proxyModeKey) === "forward") {
    context.requiredHttps(upstreamBaseUrlKey);
  }

  if (
    !context.allowPlaceholders &&
    (context.get(clientCertPathKey) || context.get(clientKeyPathKey))
  ) {
    if (!context.get(clientCertPathKey)) {
      context.fail(`${clientCertPathKey} is required when ${clientKeyPathKey} is set`);
    }
    if (!context.get(clientKeyPathKey)) {
      context.fail(`${clientKeyPathKey} is required when ${clientCertPathKey} is set`);
    }
  } else if (!context.allowPlaceholders && certificatePairDir) {
    const pair = detectMtlsCertificatePair(certificatePairDir);
    if (!pair.found) {
      context.fail(
        `Provide mTLS certificates in ${certificatePairLabel}: expected one Toss Console pair (*_public.crt + *_private.key) or client-cert.pem + client-key.pem`,
      );
    }
  }
}

export function detectMtlsCertificatePair(dir) {
  try {
    const files = readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() || entry.isSymbolicLink())
      .map((entry) => entry.name)
      .sort();

    const tossPair = detectSingleTossConsolePair(files, dir);
    if (tossPair) {
      return tossPair;
    }

    if (
      files.includes(GENERIC_CLIENT_CERT_FILE) &&
      files.includes(GENERIC_CLIENT_KEY_FILE)
    ) {
      return {
        found: true,
        kind: "generic",
        clientCertPath: joinPath(dir, GENERIC_CLIENT_CERT_FILE),
        clientKeyPath: joinPath(dir, GENERIC_CLIENT_KEY_FILE),
      };
    }
  } catch {
    return { found: false, kind: "unreadable" };
  }

  return { found: false, kind: "missing" };
}

export function looksLikeEncryptionKey(value) {
  return (
    /^[0-9a-f]{64}$/i.test(value) ||
    /^[A-Za-z0-9_-]{43,44}$/.test(value) ||
    /^[A-Za-z0-9+/]{43,44}={0,2}$/.test(value)
  );
}

export function usesMovingProxyImageTag(value) {
  if (!value) {
    return false;
  }
  const imageName = value.split("/").pop() || "";
  const tag = imageName.includes(":") ? imageName.split(":").pop() : "";
  return tag === "latest" || tag === "edge";
}

function normalizeKeyRules(rules) {
  return rules.map((rule) => (Array.isArray(rule) ? rule : [rule]));
}

function detectSingleTossConsolePair(files, dir) {
  const certPrefixes = new Set(
    files
      .filter((file) => file.endsWith(TOSS_CERT_FILE_SUFFIX))
      .map((file) => file.slice(0, -TOSS_CERT_FILE_SUFFIX.length)),
  );
  const keyPrefixes = new Set(
    files
      .filter((file) => file.endsWith(TOSS_KEY_FILE_SUFFIX))
      .map((file) => file.slice(0, -TOSS_KEY_FILE_SUFFIX.length)),
  );
  const pairPrefixes = [...certPrefixes].filter((prefix) =>
    keyPrefixes.has(prefix),
  );

  if (pairPrefixes.length !== 1) {
    return null;
  }

  const prefix = pairPrefixes[0];
  return {
    found: true,
    kind: "toss-console",
    clientCertPath: joinPath(dir, `${prefix}${TOSS_CERT_FILE_SUFFIX}`),
    clientKeyPath: joinPath(dir, `${prefix}${TOSS_KEY_FILE_SUFFIX}`),
  };
}

function joinPath(dir, file) {
  return `${String(dir || ".").replace(/\/+$/, "")}/${file}`;
}
