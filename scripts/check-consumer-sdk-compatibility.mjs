#!/usr/bin/env node

import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { compareVersions as compareSemver, parseVersion as parseSemver } from "../packages/trailbase-runtime/src/internal/semver.mjs";

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
const AIT_KIT_PACKAGE = "@ait-kit/sdk";

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

  const aitDeclaration = findDeclaration(consumerPackage, AIT_KIT_PACKAGE);
  const officialDeclaration = findDeclaration(consumerPackage, runtimeConfig.officialPackage);
  result.checks.aitKitDeclared = aitDeclaration !== null;
  result.checks.officialSdkDeclared = officialDeclaration !== null;

  const aitPackage = loadResolvedPackage(absoluteRoot, AIT_KIT_PACKAGE, failures);
  const officialPackage = loadResolvedPackage(absoluteRoot, runtimeConfig.officialPackage, failures);
  result.packages.aitKitSdk = inspectResolvedPackage({
    packageName: AIT_KIT_PACKAGE,
    declaration: aitDeclaration,
    resolved: aitPackage,
    failures,
    warnings,
    transitiveWarning: `${AIT_KIT_PACKAGE} is resolved transitively; declare it in the consumer app when its API is imported directly.`,
  });
  result.packages.officialSdk = inspectResolvedPackage({
    packageName: runtimeConfig.officialPackage,
    declaration: officialDeclaration,
    resolved: officialPackage,
    failures,
    warnings,
    transitiveWarning: `${runtimeConfig.officialPackage} is resolved transitively; declare the selected platform SDK in the consumer app.`,
  });

  const peerRange = aitPackage?.metadata?.peerDependencies?.[runtimeConfig.officialPackage];
  result.checks.aitKitPeerRange = typeof peerRange === "string" ? peerRange : null;
  if (aitPackage && typeof peerRange !== "string") {
    failures.push(`Resolved @ait-kit/sdk does not declare a peer range for ${runtimeConfig.officialPackage}.`);
  } else if (aitPackage && officialPackage?.metadata?.version && !satisfiesRange(officialPackage.metadata.version, peerRange)) {
    failures.push(`${runtimeConfig.officialPackage}@${officialPackage.metadata.version} does not satisfy @ait-kit/sdk peer range ${peerRange}.`);
  } else if (aitPackage && officialPackage?.metadata?.version) {
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

function inspectResolvedPackage({ packageName, declaration, resolved, failures, warnings, transitiveWarning }) {
  if (!resolved) return null;
  const version = resolved.metadata.version ?? null;
  const entry = {
    name: resolved.metadata.name ?? packageName,
    version,
    resolvedFrom: resolved.path,
    declaredSpec: declaration?.spec ?? null,
    declaredIn: declaration?.field ?? null,
  };
  if (!isValidVersion(version)) {
    failures.push(`Resolved ${packageName} has no valid semver version.`);
  }
  if (declaration === null) {
    warnings.push(transitiveWarning);
  } else if (version && !isComparableRange(declaration.spec)) {
    warnings.push(`${packageName}@${declaration.spec} is a non-semver package source; resolved version ${version} was inspected without comparing the declaration.`);
  } else if (version && !satisfiesRange(version, declaration.spec)) {
    failures.push(`Consumer declaration ${packageName}@${declaration.spec} does not match resolved ${version}.`);
  }
  return entry;
}

function isComparableRange(spec) {
  if (typeof spec !== "string" || spec.trim() === "") return false;
  if (/^(?:workspace:|file:|link:|git(?:\+|:)|https?:|npm:)/i.test(spec.trim())) return false;
  if (/^[A-Za-z][A-Za-z0-9._-]*$/.test(spec.trim())) return false;
  return true;
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
  return parseSemver(value) !== null;
}

export function satisfiesRange(version, range) {
  const actual = parseSemver(version);
  if (!actual || typeof range !== "string" || range.trim() === "") return false;
  const alternatives = range.split("||").map((value) => value.trim());
  if (alternatives.some((value) => value === "")) return false;
  return alternatives.some((alternative) => {
    const comparators = parseRangeAlternative(alternative);
    if (!comparators || !comparators.every((comparator) => comparatorMatches(actual, comparator))) return false;
    if (actual.prerelease.length === 0) return true;
    return comparators.some((comparator) =>
      comparator.target?.prerelease.length > 0 && sameCore(actual, comparator.target),
    );
  });
}

function parseRangeAlternative(alternative) {
  const hyphen = /^(\S+)\s+-\s+(\S+)$/.exec(alternative);
  if (hyphen) {
    const start = parseRangeVersion(hyphen[1]);
    const end = parseRangeVersion(hyphen[2]);
    if (!start || !end || start.any || end.any) return null;
    return [
      { operator: ">=", target: start },
      end.partial
        ? { operator: "<", target: upperBound(end) }
        : { operator: "<=", target: end },
    ];
  }
  const comparators = [];
  for (const token of alternative.split(/\s+/)) {
    const comparator = parseComparator(token);
    if (!comparator) return null;
    if (!comparator.any) comparators.push(comparator);
  }
  return comparators;
}

function parseComparator(token) {
  if (token === "" || token === "*" || token.toLowerCase() === "x") return { any: true };
  const match = /^(\^|~|>=|<=|>|<|=)?(.*)$/.exec(token);
  if (!match) return null;
  const operator = match[1] ?? "";
  const target = parseRangeVersion(match[2]);
  if (!target) return null;
  if (target.any) return { any: true };
  if (operator === "^") return { operator: ">=", target, upper: caretUpperBound(target) };
  if (operator === "~") return { operator: ">=", target, upper: tildeUpperBound(target) };
  if ((operator === "" || operator === "=") && target.partial) {
    return { operator: ">=", target, upper: upperBound(target) };
  }
  if (operator === "<=" && target.partial) return { operator: "<", target: upperBound(target) };
  return { operator: operator || "=", target };
}

function parseRangeVersion(value) {
  if (typeof value !== "string") return null;
  const match = /^v?(0|[1-9][0-9]*|x|X|\*)(?:\.(0|[1-9][0-9]*|x|X|\*))?(?:\.(0|[1-9][0-9]*|x|X|\*))?(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(value);
  if (!match) return null;
  const [major, minor, patch] = match.slice(1, 4);
  if (major === "x" || major === "X" || major === "*") return { any: true, prerelease: [] };
  const precision = patch !== undefined && !isWildcard(patch) ? 3 : minor !== undefined && !isWildcard(minor) ? 2 : 1;
  const core = [Number(major), isWildcard(minor) || minor === undefined ? 0 : Number(minor), isWildcard(patch) || patch === undefined ? 0 : Number(patch)];
  const prerelease = match[4]?.split(".") ?? [];
  const parsed = parseSemver(`${core.join(".")}${prerelease.length > 0 ? `-${prerelease.join(".")}` : ""}`);
  if (!parsed) return null;
  return { core: parsed.core, prerelease: parsed.prerelease, partial: precision < 3, precision };
}

function comparatorMatches(version, comparator) {
  if (comparator.any) return true;
  const comparison = compareParsed(version, comparator.target);
  if (comparator.upper) {
    const lowerMatches = comparator.operator === ">=" ? comparison >= 0 : comparison > 0;
    return lowerMatches && compareParsed(version, comparator.upper) < 0;
  }
  if (comparator.operator === ">=") return comparison >= 0;
  if (comparator.operator === ">") return comparison > 0;
  if (comparator.operator === "<=") return comparison <= 0;
  if (comparator.operator === "<") return comparison < 0;
  return comparison === 0;
}

function upperBound(target) {
  if (target.precision <= 1) return parsedVersion([target.core[0] + 1, 0, 0]);
  return parsedVersion([target.core[0], target.core[1] + 1, 0]);
}

function caretUpperBound(target) {
  if (target.core[0] > 0 || target.precision === 1) return parsedVersion([target.core[0] + 1, 0, 0]);
  if (target.core[1] > 0 || target.precision === 2) return parsedVersion([0, target.core[1] + 1, 0]);
  return parsedVersion([0, 0, target.core[2] + 1]);
}

function tildeUpperBound(target) {
  if (target.precision <= 1) return parsedVersion([target.core[0] + 1, 0, 0]);
  return parsedVersion([target.core[0], target.core[1] + 1, 0]);
}

function parsedVersion(core) {
  return { core, prerelease: [], partial: false, precision: 3 };
}

function compareParsed(left, right) {
  return compareSemver(serializeParsed(left), serializeParsed(right));
}

function serializeParsed(value) {
  return `${value.core.join(".")}${value.prerelease.length > 0 ? `-${value.prerelease.join(".")}` : ""}`;
}

function sameCore(left, right) {
  return left.core.every((value, index) => value === right.core[index]);
}

function isWildcard(value) {
  return value === "x" || value === "X" || value === "*";
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
