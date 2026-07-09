import { spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { networkInterfaces } from "node:os";

const DEFAULT_TRAILBASE_PORT = 4000;
const DEFAULT_MTLS_PROXY_PORT = 8787;

export function parseDevRunnerArgs(argv = process.argv.slice(2)) {
  const options = {
    build: true,
    detached: true,
    down: false,
    dryRun: false,
    fresh: false,
    help: false,
    printEnv: false,
    profiles: [],
    composeFiles: [],
    services: [],
    ignoreContainerNamePrefixes: [],
    projectName: undefined,
    trailbasePort: undefined,
    mtlsProxyPort: undefined,
    granitePort: undefined,
    host: "127.0.0.1",
    mtlsProxyHealthPath: "/internal/apps-in-toss/health",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const readValue = () => {
      const inline = arg.includes("=") ? arg.split("=").slice(1).join("=") : undefined;
      if (inline !== undefined) {
        return inline;
      }
      index += 1;
      return argv[index];
    };

    if (arg === "--fresh") options.fresh = true;
    else if (arg === "--down") options.down = true;
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--print-env") options.printEnv = true;
    else if (arg === "-h" || arg === "--help") options.help = true;
    else if (arg === "--no-build") options.build = false;
    else if (arg === "--attached") options.detached = false;
    else if (arg === "--profile" || arg.startsWith("--profile=")) options.profiles.push(readValue());
    else if (
      arg === "--compose-file" ||
      arg === "-f" ||
      arg.startsWith("--compose-file=")
    ) options.composeFiles.push(readValue());
    else if (
      arg === "--ignore-container-prefix" ||
      arg.startsWith("--ignore-container-prefix=")
    ) options.ignoreContainerNamePrefixes.push(readValue());
    else if (arg === "--project-name" || arg.startsWith("--project-name=")) {
      options.projectName = readValue();
    }
    else if (arg === "--service" || arg.startsWith("--service=")) options.services.push(readValue());
    else if (arg === "--mtls-health-path" || arg.startsWith("--mtls-health-path=")) {
      options.mtlsProxyHealthPath = readValue();
    }
    else if (arg === "--trailbase-port" || arg.startsWith("--trailbase-port=")) {
      options.trailbasePort = parsePort(readValue(), "trailbase port");
    }
    else if (arg === "--mtls-port" || arg.startsWith("--mtls-port=")) {
      options.mtlsProxyPort = parsePort(readValue(), "mTLS proxy port");
    }
    else if (arg === "--granite-port" || arg.startsWith("--granite-port=")) {
      options.granitePort = parsePort(readValue(), "Granite port");
    }
    else if (arg === "--host" || arg.startsWith("--host=")) options.host = readValue();
    else if (arg) options.services.push(arg);
  }

  return options;
}

export async function isPortAvailable(port, host = "127.0.0.1") {
  parsePort(port, "port");
  return await new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen({ port, host });
  });
}

export async function findAvailablePort({
  preferredPort,
  host = "127.0.0.1",
  label = "port",
  maxAttempts = 100,
  logger = console,
  busyPorts = new Set(),
  allowUnavailablePorts = new Set(),
} = {}) {
  const preferred = parsePort(preferredPort, label);
  const buildResult = (port, warning) => {
    const changed = port !== preferred;
    if (warning && logger?.warn) {
      logger.warn(`WARN ${warning}`);
    }
    return { port, preferredPort: preferred, changed, warning };
  };
  const reusablePorts = [...allowUnavailablePorts]
    .filter((port) =>
      Number.isInteger(port) &&
      port >= preferred &&
      port < preferred + maxAttempts,
    )
    .sort((left, right) => left - right);
  for (const port of reusablePorts) {
    if (!busyPorts.has(port)) {
      const warning = port !== preferred
        ? `${label} ${preferred} changed to ${port} to reuse an allowed port on ${host}`
        : undefined;
      return buildResult(port, warning);
    }
  }
  for (let offset = 0; offset < maxAttempts; offset += 1) {
    const port = preferred + offset;
    if (
      !busyPorts.has(port) &&
      (await isPortAvailable(port, host))
    ) {
      const warning = port !== preferred
        ? `${label} ${preferred} is already in use on ${host}; using ${port}`
        : undefined;
      return buildResult(port, warning);
    }
  }
  throw new Error(`Could not find an available ${label} starting at ${preferred}`);
}

export async function resolveLocalDevPorts({
  trailbasePort = DEFAULT_TRAILBASE_PORT,
  mtlsProxyPort = DEFAULT_MTLS_PROXY_PORT,
  assetPreviewPort,
  host = "127.0.0.1",
  logger = console,
  ignoreContainerNamePrefixes = [],
  spawnSyncImpl = spawnSync,
} = {}) {
  const {
    busyPorts: dockerPublishedPorts,
    ignoredPortsByService,
  } = getDockerPublishedHostPortSets({
    ignoreContainerNamePrefixes,
    logger,
    spawnSyncImpl,
  });
  const busyPorts = new Set([
    ...dockerPublishedPorts,
    ...ignoredPortsByService.unknown,
  ]);
  const trailbase = await findAvailablePort({
    preferredPort: trailbasePort,
    host,
    label: "TrailBase port",
    logger,
    busyPorts,
    allowUnavailablePorts: ignoredPortsByService.trailbase,
  });
  busyPorts.add(trailbase.port);
  const mtlsProxy = await findAvailablePort({
    preferredPort: mtlsProxyPort,
    host,
    label: "mTLS proxy port",
    logger,
    busyPorts,
    allowUnavailablePorts: ignoredPortsByService.mtlsProxy,
  });
  busyPorts.add(mtlsProxy.port);
  const assetPreview = assetPreviewPort
    ? await findAvailablePort({
        preferredPort: assetPreviewPort,
        host,
        label: "Asset preview port",
        logger,
        busyPorts,
        allowUnavailablePorts: ignoredPortsByService.assetPreview,
      })
    : undefined;
  return {
    trailbasePort: trailbase.port,
    mtlsProxyPort: mtlsProxy.port,
    assetPreviewPort: assetPreview?.port,
    granitePort: assetPreview?.port,
    changed:
      trailbase.changed || mtlsProxy.changed || Boolean(assetPreview?.changed),
    warnings: [
      trailbase.warning,
      mtlsProxy.warning,
      assetPreview?.warning,
    ].filter(Boolean),
  };
}

export function getDockerPublishedHostPorts({
  spawnSyncImpl = spawnSync,
  ignoreContainerNamePrefixes = [],
  logger = console,
} = {}) {
  return getDockerPublishedHostPortSets({
    spawnSyncImpl,
    ignoreContainerNamePrefixes,
    logger,
  }).busyPorts;
}

export function getDockerPublishedHostPortSets({
  spawnSyncImpl = spawnSync,
  ignoreContainerNamePrefixes = [],
  logger = console,
} = {}) {
  const result = spawnSyncImpl(
    "docker",
    ["ps", "--format", "{{.Names}}\t{{.Ports}}"],
    {
      encoding: "utf8",
      stdio: "pipe",
    },
  );
  if (result.status !== 0) {
    if (logger?.debug) {
      logger.debug(
        `docker ps failed while resolving dev ports: ${
          result.stderr || result.stdout || result.status
        }`,
      );
    }
    return {
      busyPorts: new Set(),
      ignoredPorts: new Set(),
      ignoredPortsByService: createIgnoredPortServiceSets(),
    };
  }
  return parseDockerPublishedHostPortSets(result.stdout, {
    ignoreContainerNamePrefixes,
  });
}

export function parseDockerPublishedHostPorts(
  output = "",
  { ignoreContainerNamePrefixes = [] } = {},
) {
  return parseDockerPublishedHostPortSets(output, {
    ignoreContainerNamePrefixes,
  }).busyPorts;
}

export function parseDockerPublishedHostPortSets(
  output = "",
  { ignoreContainerNamePrefixes = [] } = {},
) {
  const busyPorts = new Set();
  const ignoredPortsByService = createIgnoredPortServiceSets();
  for (const line of String(output).split(/\r?\n/)) {
    const [name = "", published = ""] = line.split("\t");
    const trimmedName = name.trim();
    const ignoredPrefix = ignoreContainerNamePrefixes.find((prefix) =>
      trimmedName.startsWith(prefix),
    );
    const ignored = ignoredPrefix !== undefined;
    const serviceName = ignored
      ? trimmedName.slice(ignoredPrefix.length)
      : trimmedName;
    for (const segment of published.split(",")) {
      const match = segment.trim().match(/:(\d+)(?:-\d+)?->(\d+)(?:-\d+)?\//);
      if (match) {
        const port = Number(match[1]);
        const targetPort = Number(match[2]);
        if (ignored) {
          const service = classifyIgnoredDockerPortService(serviceName, targetPort);
          ignoredPortsByService[service].add(port);
        } else {
          busyPorts.add(port);
        }
      }
    }
  }
  const ignoredPorts = new Set(
    Object.values(ignoredPortsByService).flatMap((ports) => [...ports]),
  );
  return { busyPorts, ignoredPorts, ignoredPortsByService };
}

function createIgnoredPortServiceSets() {
  return {
    trailbase: new Set(),
    mtlsProxy: new Set(),
    assetPreview: new Set(),
    unknown: new Set(),
  };
}

function classifyIgnoredDockerPortService(name, targetPort) {
  const normalized = String(name).toLowerCase();
  const nameMatches = [];
  if (
    normalized.includes("mtls") ||
    normalized.includes("toss-mtls-client-proxy")
  ) {
    nameMatches.push("mtlsProxy");
  }
  if (normalized.includes("trailbase")) {
    nameMatches.push("trailbase");
  }
  if (
    normalized.includes("granite") ||
    normalized.includes("asset") ||
    normalized.includes("preview")
  ) {
    nameMatches.push("assetPreview");
  }
  if (
    nameMatches.length === 1 &&
    nameMatches[0] === "trailbase" &&
    targetPort === DEFAULT_TRAILBASE_PORT
  ) {
    return "trailbase";
  }
  if (
    nameMatches.length === 1 &&
    nameMatches[0] === "mtlsProxy" &&
    targetPort === DEFAULT_MTLS_PROXY_PORT
  ) {
    return "mtlsProxy";
  }
  if (nameMatches.length === 1 && nameMatches[0] === "assetPreview") {
    return nameMatches[0];
  }
  return "unknown";
}

export function detectLanIp({
  interfaces = networkInterfaces(),
  preferredInterfaceNames = ["en0", "en1", "wlan0", "eth0"],
  fallback = "127.0.0.1",
} = {}) {
  const candidates = [];
  for (const name of preferredInterfaceNames) {
    for (const item of interfaces[name] ?? []) {
      if (isPrivateIpv4(item)) {
        candidates.push(item.address);
      }
    }
  }
  for (const items of Object.values(interfaces)) {
    for (const item of items ?? []) {
      if (isPrivateIpv4(item)) {
        candidates.push(item.address);
      }
    }
  }
  return candidates[0] ?? fallback;
}

export function buildComposeArgs({
  composeFiles = [],
  profiles = [],
  projectName,
  command = "up",
  detached = true,
  build = true,
  services = [],
} = {}) {
  const args = ["compose"];
  if (projectName) {
    args.push("--project-name", projectName);
  }
  for (const file of composeFiles) {
    args.push("-f", file);
  }
  for (const profile of profiles) {
    if (profile) {
      args.push("--profile", profile);
    }
  }
  args.push(command);
  if (command === "up") {
    if (detached) args.push("-d");
    if (build) args.push("--build");
  }
  args.push(...services);
  return args;
}

export function buildDevRunnerUrls({
  host = "127.0.0.1",
  trailbasePort = DEFAULT_TRAILBASE_PORT,
  mtlsProxyPort = DEFAULT_MTLS_PROXY_PORT,
  granitePort,
  mtlsProxyHealthPath = "/internal/apps-in-toss/health",
} = {}) {
  const urlHost = formatHostForUrl(localUrlHost(host));
  const urls = {
    trailbase: `http://${urlHost}:${parsePort(trailbasePort, "TrailBase port")}`,
    mtlsProxy: `http://${urlHost}:${parsePort(mtlsProxyPort, "mTLS proxy port")}`,
  };
  const healthPath = normalizeUrlPath(mtlsProxyHealthPath);
  if (healthPath) {
    urls.mtlsProxyHealth = `${urls.mtlsProxy}${healthPath}`;
  }
  if (hasOptionalPortValue(granitePort)) {
    urls.granite = `http://${urlHost}:${parsePort(granitePort, "Granite port")}`;
  }
  return urls;
}

export function buildDevRunnerEnv({
  host = "127.0.0.1",
  trailbasePort = DEFAULT_TRAILBASE_PORT,
  mtlsProxyPort = DEFAULT_MTLS_PROXY_PORT,
  granitePort,
  mtlsProxyHealthPath = "/internal/apps-in-toss/health",
  urls,
  fresh = false,
  env = {},
  now = () => Date.now(),
} = {}) {
  const resolvedUrls =
    urls ??
    buildDevRunnerUrls({
      host,
      trailbasePort,
      mtlsProxyPort,
      granitePort,
      mtlsProxyHealthPath,
    });
  const values = {
    TRAILBASE_HOST_PORT: String(parsePort(trailbasePort, "TrailBase port")),
    MTLS_PROXY_HOST_PORT: String(parsePort(mtlsProxyPort, "mTLS proxy port")),
    TRAILBASE_PUBLIC_URL: env.TRAILBASE_PUBLIC_URL || resolvedUrls.trailbase,
    TOSS_PROXY_SMOKE_URL: env.TOSS_PROXY_SMOKE_URL || resolvedUrls.mtlsProxy,
  };

  if (hasOptionalPortValue(granitePort)) {
    values.GRANITE_HOST_PORT = String(parsePort(granitePort, "Granite port"));
    values.GRANITE_DEV_SERVER_URL = env.GRANITE_DEV_SERVER_URL || resolvedUrls.granite;
  }

  if (fresh) {
    values.TRAILBASE_FRESH_START_TOKEN =
      env.TRAILBASE_FRESH_START_TOKEN || `local-dev-${now()}`;
  }

  return values;
}

export function buildDevRunnerChildEnv({
  env = process.env,
  planEnv = {},
  fresh = false,
} = {}) {
  const values = { ...env, ...planEnv };
  if (!fresh) {
    delete values.TRAILBASE_FRESH_START_TOKEN;
    delete values.TRAILBASE_FRESH_START_CONFIRM;
  }
  return values;
}

export function buildDevRunnerPlan({
  options = {},
  ports = {},
  env = {},
  now = () => Date.now(),
} = {}) {
  const host = options.host || "127.0.0.1";
  const trailbasePort = parsePort(
    ports.trailbasePort ??
      options.trailbasePort ??
      envPortValue(env.TRAILBASE_HOST_PORT, DEFAULT_TRAILBASE_PORT),
    "TrailBase port",
  );
  const mtlsProxyPort = parsePort(
    ports.mtlsProxyPort ??
      options.mtlsProxyPort ??
      envPortValue(env.MTLS_PROXY_HOST_PORT, DEFAULT_MTLS_PROXY_PORT),
    "mTLS proxy port",
  );
  const granitePort = options.down
    ? undefined
    : ports.granitePort ??
      ports.assetPreviewPort ??
      options.granitePort ??
      optionalEnvValue(env.GRANITE_HOST_PORT);
  const command = options.down ? "down" : "up";
  const composeArgs = buildComposeArgs({
    composeFiles: options.composeFiles,
    profiles: options.profiles,
    projectName: options.projectName,
    command,
    detached: options.detached,
    build: options.build,
    services: command === "down" ? [] : options.services,
  });
  const urls = buildDevRunnerUrls({
    host,
    trailbasePort,
    mtlsProxyPort,
    granitePort,
    mtlsProxyHealthPath: options.mtlsProxyHealthPath,
  });
  return {
    command: "docker",
    composeArgs,
    env: buildDevRunnerEnv({
      host,
      trailbasePort,
      mtlsProxyPort,
      granitePort,
      urls,
      fresh: options.fresh,
      env,
      now,
    }),
    urls,
  };
}

export async function createDevRunnerPlan({
  argv = process.argv.slice(2),
  env = process.env,
  logger = console,
  now = () => Date.now(),
} = {}) {
  const options = parseDevRunnerArgs(argv);
  if (options.help) {
    return { options, plan: null };
  }

  const granitePortRequest = options.granitePort ?? optionalEnvValue(env.GRANITE_HOST_PORT);
  const portRequest = {
    trailbasePort:
      options.trailbasePort ??
      envPortValue(env.TRAILBASE_HOST_PORT, DEFAULT_TRAILBASE_PORT),
    mtlsProxyPort:
      options.mtlsProxyPort ??
      envPortValue(env.MTLS_PROXY_HOST_PORT, DEFAULT_MTLS_PROXY_PORT),
    // resolveLocalDevPorts keeps this slot generic for non-Granite asset previews.
    assetPreviewPort: granitePortRequest,
    host: options.host,
    logger,
    ignoreContainerNamePrefixes: options.ignoreContainerNamePrefixes,
  };
  let ports;
  if (options.down) {
    ports = {
      trailbasePort: parsePort(portRequest.trailbasePort, "TrailBase port"),
      mtlsProxyPort: parsePort(portRequest.mtlsProxyPort, "mTLS proxy port"),
      assetPreviewPort: undefined,
    };
  } else {
    try {
      ports = await resolveLocalDevPorts(portRequest);
    } catch (error) {
      throw new Error(`Failed to resolve local dev ports: ${error.message}`, {
        cause: error,
      });
    }
  }

  return {
    options,
    plan: buildDevRunnerPlan({
      options,
      ports,
      env,
      now,
    }),
  };
}

export async function waitForHttp({
  url,
  fetchImpl = globalThis.fetch,
  timeoutMs = 60_000,
  intervalMs = 1_000,
  validate = (response) => response.ok,
  now = () => Date.now(),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  if (!url) {
    throw new Error("url is required");
  }
  const started = now();
  let lastError;
  while (now() - started <= timeoutMs) {
    try {
      const response = await fetchImpl(url);
      if (await validate(response)) {
        return response;
      }
      lastError = new Error(`Unexpected status ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(intervalMs);
  }
  throw new Error(`Timed out waiting for ${url}: ${lastError?.message ?? "unknown error"}`);
}

export function createSignalCleanup({
  signals = ["SIGINT", "SIGTERM"],
  cleanup,
  processImpl = process,
} = {}) {
  let cleaned = false;
  const handler = async (signal) => {
    if (cleaned) {
      return;
    }
    cleaned = true;
    await cleanup?.(signal);
    processImpl.exitCode = signal === "SIGINT" ? 130 : 143;
  };

  for (const signal of signals) {
    processImpl.once(signal, handler);
  }

  return () => {
    for (const signal of signals) {
      processImpl.off(signal, handler);
    }
  };
}

function isPrivateIpv4(item) {
  if (!item || item.family !== "IPv4" || item.internal) {
    return false;
  }
  return /^(10\.|172\.(1[6-9]|2\d|3[0-1])\.|192\.168\.)/.test(item.address);
}

function localUrlHost(host) {
  if (host === "0.0.0.0" || host === "::" || host === "[::]") {
    return "127.0.0.1";
  }
  return host;
}

function formatHostForUrl(host) {
  const value = String(host);
  if (value.includes(":") && !value.startsWith("[")) {
    return `[${value}]`;
  }
  return value;
}

function normalizeUrlPath(value) {
  const path = String(value ?? "").trim();
  if (!path) {
    return "";
  }
  return path.startsWith("/") ? path : `/${path}`;
}

function hasOptionalPortValue(value) {
  return value !== undefined && value !== null && value !== "";
}

function envPortValue(value, fallback) {
  return hasOptionalPortValue(value) ? value : fallback;
}

function optionalEnvValue(value) {
  return hasOptionalPortValue(value) ? value : undefined;
}

function parsePort(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 65535) {
    throw new Error(`${label} must be a port number`);
  }
  return number;
}
