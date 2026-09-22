#!/usr/bin/env node

import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const RUNTIMES = {
  rn: {
    officialPackage: "@apps-in-toss/framework",
    label: "React Native",
  },
  web: {
    officialPackage: "@apps-in-toss/web-framework",
    label: "WebView",
  },
};

const PACKAGE_FIELDS = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];

/**
 * Check a consumer's installed package metadata without importing or installing
 * any SDK module. The result deliberately says nothing about Toss app runtime
 * support; only a device or Toss app can establish that fact.
 */
export function checkConsumerSdkCompatibility({ root, runtime } = {}) {
  const failures = [];
  const warnings = [];
  const absoluteRoot = resolve(root ?? ".");
  const runtimeConfig = RUNTIMES[runtime];
  const result = {
    schemaVersion: 1,
    root: absoluteRoot,
    runtime: runtime ?? null,
    runtimeSupport: "not_checked",
    ok: false,
    packages: {
      aitKitSdk: null,
      officialSdk: null,
    },
    checks: {
      aitKitDeclared: false,
      officialSdkDeclared: false,
      aitKitPeerRange: null,
      officialSdkPeerSatisfied: false,
      runtimeSupport: "not_checked",
    },
    failures,
    warnings,
  };

  if (!runtimeConfig) {
    failures.push(`Unsupported runtime '${String(runtime)}'; use 'rn' or 'web'.`);
    return result;
  }

  let consumerPackage;
  try {
    consumerPackage = readJson(join(absoluteRoot, "package.json"));
  } catch (error) {
    failures.push(`Consumer package.json could not be read: ${safeErrorMessage(error)}`);
    return result;
  }

  const aitDeclaration = findDeclaration(consumerPackage, "@ait-kit/sdk");
  const officialDeclaration = findDeclaration(consumerPackage, runtimeConfig.officialPackage);
  result.checks.aitKitDeclared = aitDeclaration !== null;
  result.checks.officialSdkDeclared = officialDeclaration !== null;

  const aitPackage = loadResolvedPackage(absoluteRoot, "@ait-kit/sdk", failures);
  if (aitPackage) {
    result.packages.aitKitSdk = {
      name: aitPackage.metadata.name ?? "@ait-kit/sdk",
      version: aitPackage.metadata.version ?? null,
      resolvedFrom: aitPackage.path,
      declaredSpec: aitDeclaration?.spec ?? null,
      declaredIn: aitDeclaration?.field ?? null,
    };
    if (!isValidVersion(aitPackage.metadata.version)) {
      failures.push("Resolved @ait-kit/sdk has no valid semver version.");
    }
    if (aitDeclaration === null) {
      warnings.push("@ait-kit/sdk is resolved transitively; declare it in the consumer app when its API is imported directly.");
    } else if (!satisfiesRange(aitPackage.metadata.version, aitDeclaration.spec)) {
      failures.push(`Consumer declaration @ait-kit/sdk@${aitDeclaration.spec} does not match resolved ${aitPackage.metadata.version}.`);
    }
  }

  const officialPackage = loadResolvedPackage(absoluteRoot, runtimeConfig.officialPackage, failures);
  if (officialPackage) {
    result.packages.officialSdk = {
      name: officialPackage.metadata.name ?? runtimeConfig.officialPackage,
      version: officialPackage.metadata.version ?? null,
      resolvedFrom: officialPackage.path,
      declaredSpec: officialDeclaration?.spec ?? null,
      declaredIn: officialDeclaration?.field ?? null,
    };
    if (!isValidVersion(officialPackage.metadata.version)) {
      failures.push(`Resolved ${runtimeConfig.officialPackage} has no valid semver version.`);
    }
    if (officialDeclaration === null) {
      warnings.push(`${runtimeConfig.officialPackage} is resolved transitively; declare the selected platform SDK in the consumer app.`);
    } else if (!satisfiesRange(officialPackage.metadata.version, officialDeclaration.spec)) {
      failures.push(`Consumer declaration ${runtimeConfig.officialPackage}@${officialDeclaration.spec} does not match resolved ${officialPackage.metadata.version}.`);
    }
  }

  const peerRange = aitPackage?.metadata?.peerDependencies?.[runtimeConfig.officialPackage];
  result.checks.aitKitPeerRange = typeof peerRange === "string" ? peerRange : null;
  if (!aitPackage) {
    // The package resolution failure already explains why the peer check was
    // skipped; do not add a misleading comparison against an undefined range.
  } else if (typeof peerRange !== "string") {
    failures.push(`Resolved @ait-kit/sdk does not declare a peer range for ${runtimeConfig.officialPackage}.`);
  } else if (officialPackage?.metadata?.version && !satisfiesRange(officialPackage.metadata.version, peerRange)) {
    failures.push(`${runtimeConfig.officialPackage}@${officialPackage.metadata.version} does not satisfy @ait-kit/sdk peer range ${peerRange}.`);
  } else if (officialPackage?.metadata?.version) {
    result.checks.officialSdkPeerSatisfied = true;
  }

  result.ok = failures.length === 0;
  return result;
}

export function renderCompatibilityResult(result) {
  const lines = [
    `${result.ok ? "PASS" : "FAIL"} consumer SDK compatibility (${result.runtime ?? "unknown"})`,
    `  Runtime support: ${result.runtimeSupport}`,
  ];
  for (const [key, value] of Object.entries(result.packages ?? {})) {
    if (value) lines.push(`  ${key}: ${value.name}@${value.version}`);
  }
  for (const warning of result.warnings ?? []) lines.push(`  WARN ${warning}`);
  for (const failure of result.failures ?? []) lines.push(`  FAIL ${failure}`);
  return lines.join("\n");
}

function findDeclaration(packageJson, packageName) {
  for (const field of PACKAGE_FIELDS) {
    const spec = packageJson?.[field]?.[packageName];
    if (typeof spec === "string" && spec.length > 0) return { field, spec };
  }
  return null;
}

function loadResolvedPackage(root, packageName, failures) {
  const packagePath = resolvePackageJson(root, packageName);
  if (!packagePath) {
    failures.push(`Required package ${packageName} is not resolvable from the consumer root.`);
    return null;
  }
  try {
    return { path: packagePath, metadata: readJson(packagePath) };
  } catch (error) {
    if (error?.code === "ENOENT") {
      failures.push(`Required package ${packageName} is not resolvable from the consumer root.`);
      return null;
    }
    failures.push(`Resolved ${packageName}/package.json could not be read: ${safeErrorMessage(error)}`);
    return null;
  }
}

function resolvePackageJson(root, packageName) {
  const require = createRequire(join(root, "package.json"));
  try {
    return require.resolve(`${packageName}/package.json`);
  } catch {
    // Some packages intentionally omit package.json from their export map.
    // Read only the conventional metadata file without importing package code.
    const packageParts = packageName.split("/");
    let current = root;
    while (true) {
      const candidate = join(current, "node_modules", ...packageParts, "package.json");
      if (existsSync(candidate)) return candidate;
      const parent = dirname(current);
      if (parent === current) return null;
      current = parent;
    }
  }
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function safeErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function isValidVersion(value) {
  return parseVersion(value) !== null;
}

function parseVersion(value, allowPartial = false) {
  if (typeof value !== "string") return null;
  const match = /^v?(\d+)(?:\.(\d+|x|X|\*))?(?:\.(\d+|x|X|\*))?(?:-([0-9A-Za-z.-]+))?$/.exec(value.trim());
  if (!match) return null;
  if (!allowPartial && (match[2] === undefined || match[3] === undefined || /[xX*]/.test(`${match[2]}${match[3]}`))) return null;
  return {
    major: Number(match[1]),
    minor: match[2] === undefined || /[xX*]/.test(match[2]) ? 0 : Number(match[2]),
    patch: match[3] === undefined || /[xX*]/.test(match[3]) ? 0 : Number(match[3]),
    partial: match[2] === undefined || match[3] === undefined || /[xX*]/.test(`${match[2] ?? ""}${match[3] ?? ""}`),
    prerelease: match[4]?.split(".") ?? [],
  };
}

export function satisfiesRange(version, range) {
  const actual = parseVersion(version);
  if (!actual || typeof range !== "string" || range.trim() === "") return false;
  return range.split("||").some((alternative) => alternative.trim().split(/\s+/).every((token) => satisfiesComparator(actual, token)));
}

function satisfiesComparator(version, token) {
  if (!token || token === "*" || token.toLowerCase() === "x") return true;
  const operator = /^(\^|~|>=|<=|>|<|=)?(.*)$/.exec(token);
  if (!operator) return false;
  const [, prefix = "", raw] = operator;
  const target = parseVersion(raw, true);
  if (!target) return false;
  if (prefix === "^") {
    if (compareVersions(version, target) < 0) return false;
    const upper = target.major > 0 ? { major: target.major + 1, minor: 0, patch: 0, prerelease: [] } : target.minor > 0
      ? { major: 0, minor: target.minor + 1, patch: 0, prerelease: [] }
      : { major: 0, minor: 0, patch: target.patch + 1, prerelease: [] };
    return compareVersions(version, upper) < 0;
  }
  if (prefix === "~") {
    if (compareVersions(version, target) < 0) return false;
    const upper = { major: target.major, minor: target.minor + 1, patch: 0, prerelease: [] };
    return compareVersions(version, upper) < 0;
  }
  const comparison = compareVersions(version, target);
  if (prefix === ">=") return comparison >= 0;
  if (prefix === ">") return comparison > 0;
  if (prefix === "<=") return comparison <= 0;
  if (prefix === "<") return comparison < 0;
  if (prefix === "=") return comparison === 0;
  if (target.partial) {
    if (version.major !== target.major) return false;
    if (raw.includes(".")) return version.minor === target.minor;
    return true;
  }
  return comparison === 0;
}

function compareVersions(left, right) {
  for (const key of ["major", "minor", "patch"]) {
    if (left[key] !== right[key]) return left[key] > right[key] ? 1 : -1;
  }
  if (left.prerelease.length === 0 && right.prerelease.length > 0) return 1;
  if (left.prerelease.length > 0 && right.prerelease.length === 0) return -1;
  for (let index = 0; index < Math.max(left.prerelease.length, right.prerelease.length); index += 1) {
    const leftPart = left.prerelease[index];
    const rightPart = right.prerelease[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    if (leftPart === rightPart) continue;
    const leftNumber = /^\d+$/.test(leftPart) ? Number(leftPart) : null;
    const rightNumber = /^\d+$/.test(rightPart) ? Number(rightPart) : null;
    if (leftNumber !== null && rightNumber !== null) return leftNumber > rightNumber ? 1 : -1;
    if (leftNumber !== null) return -1;
    if (rightNumber !== null) return 1;
    return leftPart > rightPart ? 1 : -1;
  }
  return 0;
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help") return { help: true };
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--root" || arg === "--runtime") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}.`);
      options[arg.slice(2)] = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }
  if (!options.root || !options.runtime) throw new Error("Usage: node scripts/check-consumer-sdk-compatibility.mjs --root <consumer-root> --runtime <rn|web> [--json]");
  return options;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      console.log("Usage: node scripts/check-consumer-sdk-compatibility.mjs --root <consumer-root> --runtime <rn|web> [--json]");
      process.exit(0);
    }
    const result = checkConsumerSdkCompatibility(options);
    console.log(options.json ? JSON.stringify(result, null, 2) : renderCompatibilityResult(result));
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    console.error(safeErrorMessage(error));
    process.exitCode = 2;
  }
}
