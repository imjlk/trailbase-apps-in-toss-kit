import { spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { networkInterfaces } from "node:os";

export function parseDevRunnerArgs(argv = process.argv.slice(2)) {
  const options = {
    build: true,
    detached: true,
    down: false,
    fresh: false,
    profiles: [],
    composeFiles: [],
    services: [],
    trailbasePort: undefined,
    mtlsProxyPort: undefined,
    granitePort: undefined,
    host: "127.0.0.1",
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
    else if (arg === "--no-build") options.build = false;
    else if (arg === "--attached") options.detached = false;
    else if (arg === "--profile" || arg.startsWith("--profile=")) options.profiles.push(readValue());
    else if (arg === "--compose-file" || arg === "-f" || arg.startsWith("--compose-file=")) options.composeFiles.push(readValue());
    else if (arg === "--service" || arg.startsWith("--service=")) options.services.push(readValue());
    else if (arg === "--trailbase-port" || arg.startsWith("--trailbase-port=")) options.trailbasePort = parsePort(readValue(), "trailbase port");
    else if (arg === "--mtls-port" || arg.startsWith("--mtls-port=")) options.mtlsProxyPort = parsePort(readValue(), "mTLS proxy port");
    else if (arg === "--granite-port" || arg.startsWith("--granite-port=")) options.granitePort = parsePort(readValue(), "Granite port");
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
} = {}) {
  const preferred = parsePort(preferredPort, label);
  for (let offset = 0; offset < maxAttempts; offset += 1) {
    const port = preferred + offset;
    if (!busyPorts.has(port) && (await isPortAvailable(port, host))) {
      const changed = port !== preferred;
      const warning = changed
        ? `${label} ${preferred} is already in use on ${host}; using ${port}`
        : undefined;
      if (warning && logger?.warn) {
        logger.warn(`WARN ${warning}`);
      }
      return { port, preferredPort: preferred, changed, warning };
    }
  }
  throw new Error(`Could not find an available ${label} starting at ${preferred}`);
}

export async function resolveLocalDevPorts({
  trailbasePort = 4000,
  mtlsProxyPort = 8787,
  assetPreviewPort,
  host = "127.0.0.1",
  logger = console,
  ignoreContainerNamePrefixes = [],
} = {}) {
  const dockerPublishedPorts = getDockerPublishedHostPorts({
    ignoreContainerNamePrefixes,
    logger,
  });
  const busyPorts = new Set(dockerPublishedPorts);
  const trailbase = await findAvailablePort({
    preferredPort: trailbasePort,
    host,
    label: "TrailBase port",
    logger,
    busyPorts,
  });
  busyPorts.add(trailbase.port);
  const mtlsProxy = await findAvailablePort({
    preferredPort: mtlsProxyPort,
    host,
    label: "mTLS proxy port",
    logger,
    busyPorts,
  });
  busyPorts.add(mtlsProxy.port);
  const assetPreview = assetPreviewPort
    ? await findAvailablePort({
        preferredPort: assetPreviewPort,
        host,
        label: "Asset preview port",
        logger,
        busyPorts,
      })
    : undefined;
  return {
    trailbasePort: trailbase.port,
    mtlsProxyPort: mtlsProxy.port,
    assetPreviewPort: assetPreview?.port,
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
    return new Set();
  }
  return parseDockerPublishedHostPorts(result.stdout, {
    ignoreContainerNamePrefixes,
  });
}

export function parseDockerPublishedHostPorts(
  output = "",
  { ignoreContainerNamePrefixes = [] } = {},
) {
  const ports = new Set();
  for (const line of String(output).split(/\r?\n/)) {
    const [name = "", published = ""] = line.split("\t");
    if (
      ignoreContainerNamePrefixes.some((prefix) =>
        name.trim().startsWith(prefix),
      )
    ) {
      continue;
    }
    for (const segment of published.split(",")) {
      const match = segment.trim().match(/:(\d+)(?:-\d+)?->/);
      if (match) {
        ports.add(Number(match[1]));
      }
    }
  }
  return ports;
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
  command = "up",
  detached = true,
  build = true,
  services = [],
} = {}) {
  const args = ["compose"];
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

function parsePort(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 65535) {
    throw new Error(`${label} must be a port number`);
  }
  return number;
}
