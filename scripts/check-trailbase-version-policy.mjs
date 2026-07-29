import { readFile } from "node:fs/promises";

const COMPAT_POLICY_PATH = "data/trailbase-compat-policy.json";
const UPSTREAM_POLICY_PATH = "data/upstream/trailbase/version-policy.json";
const MOVING_TAGS = new Set(["latest", "edge", "main", "nightly", "dev", "stable"]);

const args = process.argv.slice(2);
const strict = hasFlag("--strict") || process.env.CI_STRICT === "1";

function usage() {
  console.log(`Usage:
  node scripts/check-trailbase-version-policy.mjs [--strict] [--version 0.31.1]
  node scripts/check-trailbase-version-policy.mjs [--strict] [--image trailbase/trailbase:0.31.1]
  node scripts/check-trailbase-version-policy.mjs [--strict] [--compose docker-compose.yml]

Environment fallbacks:
  TRAILBASE_SERVER_VERSION=0.31.1
  TRAILBASE_IMAGE=trailbase/trailbase:0.31.1
  CI_STRICT=1
`);
}

function hasFlag(flag) {
  return args.includes(flag);
}

function optionValue(flag) {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === flag) return args[index + 1] ?? null;
    if (arg.startsWith(`${flag}=`)) return arg.slice(flag.length + 1);
  }

  return null;
}

function warning(message) {
  if (process.env.GITHUB_ACTIONS) {
    console.warn(`::warning title=TrailBase server version::${message}`);
  } else {
    console.warn(`warning: ${message}`);
  }
}

function info(message) {
  console.log(`info: ${message}`);
}

async function readJsonOrNull(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (err) {
    warning(`Could not read ${path}: ${err.message}`);
    return null;
  }
}

function normalizeVersion(value) {
  return String(value ?? "").trim().replace(/^v/i, "");
}

function policyVersion(value) {
  const normalized = normalizeVersion(value);
  if (!normalized || normalized.toUpperCase() === "TBD") return null;
  if (!parseComparableVersion(normalized)) {
    warning(`Ignoring invalid policy version '${value}'. Use MAJOR.MINOR[.PATCH] or TBD.`);
    return null;
  }
  return normalized;
}

function parseComparableVersion(value) {
  const normalized = normalizeVersion(value).split(/[+-]/)[0];
  const match = normalized.match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?$/);
  if (!match) return null;

  return {
    raw: normalizeVersion(value),
    parts: [
      Number.parseInt(match[1], 10),
      Number.parseInt(match[2] ?? "0", 10),
      Number.parseInt(match[3] ?? "0", 10)
    ]
  };
}

function compareVersions(left, right) {
  const leftVersion = parseComparableVersion(left);
  const rightVersion = parseComparableVersion(right);

  if (!leftVersion || !rightVersion) {
    throw new Error(`Cannot compare versions: ${left} and ${right}`);
  }

  for (let index = 0; index < 3; index += 1) {
    if (leftVersion.parts[index] < rightVersion.parts[index]) return -1;
    if (leftVersion.parts[index] > rightVersion.parts[index]) return 1;
  }

  return 0;
}

function materializeShellDefault(value) {
  return value.replace(/\$\{[A-Za-z_][A-Za-z0-9_]*(?::-|-)([^}]+)\}/g, "$1");
}

function unquote(value) {
  return value.trim().replace(/^["']|["']$/g, "");
}

function parseVersionFromImage(image) {
  const materialized = materializeShellDefault(unquote(image));
  if (materialized.includes("${")) {
    return { kind: "dynamic-tag", tag: materialized };
  }

  const withoutDigest = materialized.split("@")[0];
  const lastSlash = withoutDigest.lastIndexOf("/");
  const lastColon = withoutDigest.lastIndexOf(":");

  if (lastColon === -1 || lastColon < lastSlash) {
    return { kind: "missing-tag", tag: null };
  }

  const tag = withoutDigest.slice(lastColon + 1);
  if (MOVING_TAGS.has(tag.toLowerCase())) {
    return { kind: "moving-tag", tag };
  }

  if (!parseComparableVersion(tag)) {
    return { kind: "non-semver-tag", tag };
  }

  return { kind: "version", version: normalizeVersion(tag), tag };
}

function isTrailBaseServerImage(image) {
  const lower = image.toLowerCase();
  return lower.includes("trailbase") && !lower.includes("toss-mtls-client-proxy");
}

async function readComposeTargets(composePath) {
  const content = await readFile(composePath, "utf8");
  const targets = [];

  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s*image\s*:\s*(.+?)\s*(?:#.*)?$/);
    if (!match) continue;

    const image = materializeShellDefault(unquote(match[1]));
    if (!isTrailBaseServerImage(image)) continue;

    targets.push({
      source: `${composePath} image`,
      image,
      parsed: parseVersionFromImage(image)
    });
  }

  return targets;
}

async function collectTargets() {
  const targets = [];
  const explicitVersion = optionValue("--version") ?? process.env.TRAILBASE_SERVER_VERSION;
  const image = optionValue("--image") ?? process.env.TRAILBASE_IMAGE;
  const composePath = optionValue("--compose");

  if (explicitVersion) {
    targets.push({
      source: "--version",
      version: normalizeVersion(explicitVersion),
      parsed: parseComparableVersion(explicitVersion)
        ? { kind: "version", version: normalizeVersion(explicitVersion), tag: normalizeVersion(explicitVersion) }
        : { kind: "non-semver-tag", tag: explicitVersion }
    });
  }

  if (image) {
    targets.push({
      source: "--image",
      image,
      parsed: parseVersionFromImage(image)
    });
  }

  if (composePath) {
    targets.push(...(await readComposeTargets(composePath)));
  }

  return targets;
}

function reportUnparseableTarget(target) {
  const label = target.image ? `${target.source} (${target.image})` : target.source;
  switch (target.parsed.kind) {
    case "moving-tag":
      return `${label} uses moving tag '${target.parsed.tag}'. Prefer an exact TrailBase SemVer tag.`;
    case "dynamic-tag":
      return `${label} uses a dynamic image value without a parseable default.`;
    case "missing-tag":
      return `${label} has no image tag. Prefer an exact TrailBase SemVer tag.`;
    case "non-semver-tag":
      return `${label} uses non-SemVer tag '${target.parsed.tag}'.`;
    default:
      return `${label} does not contain a parseable TrailBase version.`;
  }
}

function evaluateTarget(target, policy, upstream) {
  const minimum = policyVersion(policy?.kitMinimumSupportedTrailbaseServer);
  const verified = policyVersion(policy?.lastVerifiedTrailbaseServer);
  const latest = policyVersion(upstream?.latestTrailbaseVersion);
  const failures = [];

  if (target.parsed.kind !== "version") {
    const message = reportUnparseableTarget(target);
    warning(message);
    if (strict) failures.push(message);
    return failures;
  }

  const current = target.parsed.version;
  const label = target.image ? `${target.source} (${target.image})` : target.source;
  info(`${label} resolved TrailBase server version ${current}.`);

  if (minimum) {
    if (compareVersions(current, minimum) < 0) {
      const message = `${label} uses TrailBase ${current}, below kit minimum ${minimum}.`;
      warning(message);
      if (strict) failures.push(message);
    } else {
      info(`${label} is at or above kit minimum ${minimum}.`);
    }
  } else {
    info("Kit minimum supported TrailBase server is not declared yet; no minimum-version gate applied.");
  }

  if (verified) {
    if (compareVersions(current, verified) > 0) {
      const message = `${label} uses TrailBase ${current}, newer than last verified ${verified}; run consumer smoke tests before treating it as supported.`;
      warning(message);
      if (strict) failures.push(message);
    } else {
      info(`${label} is not newer than last verified ${verified}.`);
    }
  } else {
    info("Last verified TrailBase server is not declared yet; newer-than-verified checks are advisory only.");
  }

  if (latest) {
    const latestCompare = compareVersions(current, latest);
    if (latestCompare < 0) {
      info(`${label} is behind upstream latest ${latest}. This is allowed unless it falls below the kit minimum or the consumer policy says otherwise.`);
    } else if (latestCompare > 0) {
      warning(`${label} is newer than tracked upstream latest ${latest}; refresh ${UPSTREAM_POLICY_PATH}.`);
    } else {
      info(`${label} matches tracked upstream latest ${latest}.`);
    }
  } else {
    warning(`No upstream latest TrailBase version found in ${UPSTREAM_POLICY_PATH}.`);
  }

  return failures;
}

if (hasFlag("--help") || hasFlag("-h")) {
  usage();
  process.exit(0);
}

const [policy, upstream, targets] = await Promise.all([
  readJsonOrNull(COMPAT_POLICY_PATH),
  readJsonOrNull(UPSTREAM_POLICY_PATH),
  collectTargets()
]);

if (targets.length === 0) {
  warning(
    "No TrailBase server version found. Pass --version, --image, --compose, TRAILBASE_SERVER_VERSION, or TRAILBASE_IMAGE from the consumer app."
  );
  process.exit(0);
}

const failures = targets.flatMap((target) => evaluateTarget(target, policy, upstream));

if (failures.length > 0) {
  console.error(`TrailBase server version policy failed in strict mode with ${failures.length} issue(s).`);
  process.exit(1);
}

console.log("TrailBase server version policy check completed.");
