#!/usr/bin/env node

import { lstatSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * Advisory RN-to-WebView migration report for a consumer checkout.
 *
 * It reads source text and package.json metadata only: nothing is imported,
 * installed or executed. Classification comes from
 * data/webview-migration-map.json, which the ait-web package tests keep exact.
 * The report cannot establish device, login, payment or ad behavior.
 */

export const DEFAULT_MAP_PATH = fileURLToPath(new URL("../data/webview-migration-map.json", import.meta.url));

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]);
const SKIPPED_DIRECTORIES = new Set([
  "node_modules", "vendor", "dist", "build", "out", "output", "coverage", "target", "tmp",
]);
const MAX_SOURCE_BYTES = 2 * 1024 * 1024;
const MAX_FILES = 50_000;
const PACKAGE_FIELDS = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];
const RN_UI_PACKAGES = ["react-native", "@granite-js/react-native", "@toss/tds-react-native"];

const ACTIONS = ["blocked", "rewrite", "swap-import", "review"];

export function loadMigrationMap(path = DEFAULT_MAP_PATH) {
  const map = JSON.parse(readFileSync(path, "utf8"));
  if (map?.schemaVersion !== 1 || !map.subpaths || typeof map.subpaths !== "object") {
    throw new Error("Unsupported WebView migration map; expected schemaVersion 1.");
  }
  return map;
}

export function checkConsumerWebViewMigration({ root, map = loadMigrationMap(), strict = false } = {}) {
  const absoluteRoot = resolve(root ?? ".");
  let rootStat;
  try {
    rootStat = statSync(absoluteRoot);
  } catch {
    throw new Error(`Consumer root does not exist or cannot be read: ${absoluteRoot}`);
  }
  if (!rootStat.isDirectory()) throw new Error(`Consumer root is not a directory: ${absoluteRoot}`);
  const failures = [];
  const warnings = [];
  // Anything that leaves part of the checkout unread. Strict mode fails on these
  // because an unread file can still hold an RN import.
  const scanIssues = [];
  const packages = {
    rnSdk: map.rnSdkPackage,
    webSdk: map.webSdkPackage,
    aitRn: map.rnPackage,
    aitWeb: map.webPackage,
  };
  const footprint = Object.fromEntries(Object.keys(packages).map((key) => [key, { declaredIn: [], importFiles: [] }]));
  footprint.rnUi = { declaredIn: [], importFiles: [] };
  const configs = { granite: [], appsInToss: [] };
  const webOnlyPackageDirectories = new Set();
  const usages = new Map();

  const { files, truncated, unreadable } = walk(absoluteRoot);
  if (truncated) scanIssues.push(`Stopped after ${MAX_FILES} files; pass a narrower --root.`);
  for (const directory of unreadable) scanIssues.push(`Could not read directory ${toPosix(relative(absoluteRoot, directory)) || "."}.`);

  for (const file of files) {
    const rel = toPosix(relative(absoluteRoot, file));
    const name = basename(file);
    if (name === "package.json") {
      const declared = inspectPackageJson(file, rel, packages, footprint, scanIssues);
      if (declared.has("webSdk") && !declared.has("rnSdk")) webOnlyPackageDirectories.add(directoryOf(rel));
      continue;
    }
    if (/^granite\.config\.[cm]?[jt]s$/.test(name)) configs.granite.push(rel);
    if (/^apps-in-toss\.config\.[cm]?[jt]s$/.test(name)) configs.appsInToss.push(rel);
    if (!SOURCE_EXTENSIONS.has(extname(name))) continue;

    let source;
    try {
      if (lstatSync(file).size > MAX_SOURCE_BYTES) {
        scanIssues.push(`Skipped ${rel}: larger than ${MAX_SOURCE_BYTES / 1024 / 1024} MiB, so its imports were not checked.`);
        continue;
      }
      source = readFileSync(file, "utf8");
    } catch {
      scanIssues.push(`Could not read ${rel}.`);
      continue;
    }
    const imports = parseImports(source);
    const seen = new Set();
    for (const entry of imports) {
      const specifier = entry.specifier;
      for (const [key, packageName] of Object.entries(packages)) {
        if (matchesPackage(specifier, packageName)) seen.add(key);
      }
      if (RN_UI_PACKAGES.some((packageName) => matchesPackage(specifier, packageName))) seen.add("rnUi");
      if (matchesPackage(specifier, map.rnPackage)) recordRnImport(entry, rel, map, usages, warnings);
    }
    for (const key of seen) footprint[key].importFiles.push(rel);
  }

  const items = [...usages.values()]
    .map((item) => ({ ...item, files: [...item.files].sort() }))
    .sort((left, right) =>
      ACTIONS.indexOf(left.action) - ACTIONS.indexOf(right.action) ||
      left.subpath.localeCompare(right.subpath) ||
      String(left.name).localeCompare(String(right.name)));

  const has = (key) => footprint[key].declaredIn.length > 0 || footprint[key].importFiles.length > 0;
  const rn = has("rnSdk") || has("aitRn");
  const web = has("webSdk") || has("aitWeb");
  const stage = rn && web ? "dual" : rn ? "rn-only" : web ? "webview-only" : "none";

  for (const config of configs.granite) {
    if (webOnlyPackageDirectories.has(directoryOf(config))) {
      warnings.push(`${config} belongs to a WebView package; SDK 3 projects use apps-in-toss.config.* instead.`);
    }
  }
  if (strict && rn) {
    failures.push("React Native footprint remains (ait-rn or @apps-in-toss/framework); strict mode requires a WebView-only consumer.");
  }
  if (strict && scanIssues.length > 0) {
    failures.push(`Scan incomplete (${scanIssues.length} issue${scanIssues.length === 1 ? "" : "s"}); strict mode cannot confirm that no React Native footprint remains.`);
  }

  const summary = Object.fromEntries(ACTIONS.map((action) => [action, items.filter((item) => item.action === action).length]));
  return {
    schemaVersion: 1,
    root: absoluteRoot,
    strict,
    stage,
    ok: failures.length === 0,
    footprint: Object.fromEntries(Object.entries(footprint).map(([key, value]) => [key, {
      declaredIn: [...new Set(value.declaredIn)].sort(),
      importFiles: [...new Set(value.importFiles)].sort(),
    }])),
    configs: { granite: configs.granite.sort(), appsInToss: configs.appsInToss.sort() },
    summary,
    items,
    failures,
    warnings,
    scanIssues,
  };
}

function walk(root) {
  const files = [];
  const unreadable = [];
  const stack = [root];
  let truncated = false;
  while (stack.length > 0) {
    const directory = stack.pop();
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch (error) {
      if (directory === root) throw new Error(`Consumer root cannot be read: ${root}`, { cause: error });
      unreadable.push(directory);
      continue;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.startsWith(".") || SKIPPED_DIRECTORIES.has(entry.name)) continue;
        stack.push(path);
      } else if (entry.isFile()) {
        if (files.length >= MAX_FILES) {
          truncated = true;
          return { files, truncated, unreadable };
        }
        files.push(path);
      }
    }
  }
  return { files: files.sort(), truncated, unreadable: unreadable.sort() };
}

function inspectPackageJson(file, rel, packages, footprint, scanIssues) {
  const declared = new Set();
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    scanIssues.push(`Could not parse ${rel}.`);
    return declared;
  }
  for (const field of PACKAGE_FIELDS) {
    const dependencies = manifest?.[field];
    if (!dependencies || typeof dependencies !== "object") continue;
    for (const [key, packageName] of Object.entries(packages)) {
      if (Object.hasOwn(dependencies, packageName)) declared.add(key);
    }
    if (RN_UI_PACKAGES.some((packageName) => Object.hasOwn(dependencies, packageName))) declared.add("rnUi");
  }
  for (const key of declared) footprint[key].declaredIn.push(rel);
  return declared;
}

function directoryOf(rel) {
  const index = rel.lastIndexOf("/");
  return index === -1 ? "" : rel.slice(0, index);
}

/**
 * Static/dynamic import and re-export specifiers with their named bindings.
 * Comments and the contents of string, template and regex literals are masked
 * first, so commented-out imports and import examples inside strings do not count.
 */
export function parseImports(source) {
  const { code, strings } = maskSource(source);
  const literal = (raw) => (/^\d+$/.test(raw) ? strings[Number(raw)] : raw);
  const imports = [];
  const bindingPattern = /\b(import|export)(\s+type)?\s*(?:(?<![\w$])([\w$]+)\s*,\s*)?(\{[^}]*\}|\*\s*(?:as\s+[\w$]+)?|(?<![\w$])[\w$]+)\s*from\s*["']([^"'\n]+)["']/g;
  for (const match of code.matchAll(bindingPattern)) {
    const [, keyword, typeKeyword, defaultBinding, clause, rawSpecifier] = match;
    const specifier = literal(rawSpecifier);
    const typeOnly = Boolean(typeKeyword);
    if (clause.startsWith("{")) {
      const names = clause.slice(1, -1).split(",").map((part) => part.trim()).filter(Boolean).map((part) => {
        const itemTypeOnly = typeOnly || /^type\s/.test(part);
        const imported = part.replace(/^type\s+/, "").split(/\s+as\s+/)[0].trim();
        return { name: imported, typeOnly: itemTypeOnly };
      });
      imports.push({ specifier, kind: "named", names });
      if (defaultBinding) imports.push({ specifier, kind: "default", names: [] });
    } else if (clause.startsWith("*")) {
      imports.push({ specifier, kind: keyword === "export" && !clause.includes("as") ? "reexport-all" : "namespace", names: [] });
    } else {
      imports.push({ specifier, kind: typeOnly ? "type-default" : "default", names: [] });
    }
  }
  for (const match of code.matchAll(/\bimport\s*["']([^"'\n]+)["']/g)) {
    imports.push({ specifier: literal(match[1]), kind: "side-effect", names: [] });
  }
  for (const match of code.matchAll(/\b(?:import|require)\s*\(\s*["']([^"'\n]+)["']\s*\)/g)) {
    imports.push({ specifier: literal(match[1]), kind: "dynamic", names: [] });
  }
  return imports;
}

const REGEX_PRECEDING_PUNCTUATORS = new Set([..."(,=:[!&|?{};+-*%<>~^"]);
const REGEX_PRECEDING_KEYWORDS = new Set([
  "return", "typeof", "case", "do", "else", "in", "of", "void", "throw", "delete", "new", "yield", "await", "instanceof",
]);

/**
 * Lexes just enough JavaScript/TypeScript to tell code from non-code. Comments
 * and template/regex literals become spaces (newlines kept). Each quoted
 * string becomes a numbered placeholder whose value is kept in `strings`, so an
 * import specifier can be recovered while string contents never match.
 * A quote left open at the end of a line (JSX text such as "don't") masks the
 * rest of that line.
 */
export function maskSource(source) {
  const out = [];
  const strings = [];
  let tail = "";
  const emit = (text) => {
    out.push(text);
    tail = (tail + text).slice(-32);
  };
  const blank = (text) => text.replace(/[^\n]/g, " ");
  const special = /[/'"`]/g;
  let index = 0;
  while (index < source.length) {
    special.lastIndex = index;
    const found = special.exec(source);
    if (!found) {
      emit(source.slice(index));
      break;
    }
    if (found.index > index) emit(source.slice(index, found.index));
    index = found.index;
    const char = source[index];
    const next = source[index + 1];
    if (char === "/" && next === "/") {
      const end = source.indexOf("\n", index);
      const stop = end === -1 ? source.length : end;
      emit(" ".repeat(stop - index));
      index = stop;
    } else if (char === "/" && next === "*") {
      const end = source.indexOf("*/", index + 2);
      const stop = end === -1 ? source.length : end + 2;
      emit(blank(source.slice(index, stop)));
      index = stop;
    } else if (char === "'" || char === '"') {
      let cursor = index + 1;
      let value = "";
      while (cursor < source.length && source[cursor] !== char && source[cursor] !== "\n") {
        if (source[cursor] === "\\" && cursor + 1 < source.length) {
          value += source[cursor + 1];
          cursor += 2;
          continue;
        }
        value += source[cursor];
        cursor += 1;
      }
      if (source[cursor] === char) {
        emit(`${char}${strings.length}${char}`);
        strings.push(value);
        index = cursor + 1;
      } else {
        emit(" ".repeat(cursor - index));
        index = cursor;
      }
    } else if (char === "`") {
      let cursor = index + 1;
      let depth = 0;
      while (cursor < source.length) {
        const current = source[cursor];
        if (current === "\\") {
          cursor += 2;
          continue;
        }
        if (current === "`" && depth === 0) break;
        if (current === "$" && source[cursor + 1] === "{") {
          depth += 1;
          cursor += 2;
          continue;
        }
        if (current === "}" && depth > 0) depth -= 1;
        cursor += 1;
      }
      const stop = Math.min(source.length, cursor + 1);
      emit(blank(source.slice(index, stop)));
      index = stop;
    } else {
      const stop = regexAllowedAfter(tail) ? regexLiteralEnd(source, index) : -1;
      if (stop === -1) {
        emit(char);
        index += 1;
      } else {
        emit(" ".repeat(stop - index));
        index = stop;
      }
    }
  }
  return { code: out.join(""), strings };
}

function regexAllowedAfter(tail) {
  const trimmed = tail.trimEnd();
  if (!trimmed) return true;
  const last = trimmed[trimmed.length - 1];
  if (REGEX_PRECEDING_PUNCTUATORS.has(last)) return true;
  const word = /[\w$]+$/.exec(trimmed)?.[0];
  return word !== undefined && REGEX_PRECEDING_KEYWORDS.has(word);
}

/** End offset of a regex literal starting at `start`, or -1 when it is not one. */
function regexLiteralEnd(source, start) {
  let cursor = start + 1;
  let inClass = false;
  while (cursor < source.length && source[cursor] !== "\n") {
    const current = source[cursor];
    if (current === "\\") {
      cursor += 2;
      continue;
    }
    // A backtick cannot be skipped as regex text: it may open a multi-line template.
    if (current === "`") return -1;
    if (current === "[") inClass = true;
    else if (current === "]") inClass = false;
    else if (current === "/" && !inClass) {
      cursor += 1;
      while (cursor < source.length && /[a-z]/i.test(source[cursor])) cursor += 1;
      return cursor;
    }
    cursor += 1;
  }
  return -1;
}

function matchesPackage(specifier, packageName) {
  return specifier === packageName || specifier.startsWith(`${packageName}/`);
}

function recordRnImport(entry, rel, map, usages, warnings) {
  const subpath = entry.specifier === map.rnPackage ? "." : entry.specifier.slice(map.rnPackage.length + 1);
  if (subpath !== "." && !map.subpaths[subpath]) {
    addUsage(usages, {
      subpath, name: null, action: "review", rel,
      reason: "Subpath is not in this kit's migration map; update the kit submodule or check the import.",
    });
    warnings.push(`Unknown ait-rn subpath '${subpath}' in ${rel}.`);
    return;
  }
  if (entry.kind !== "named") {
    addUsage(usages, {
      subpath, name: null, action: "review", rel,
      reason: `A ${entry.kind} import cannot be classified by name; switch to named imports or review every export it uses.`,
    });
    return;
  }
  for (const { name, typeOnly } of entry.names) {
    // The map classifies runtime exports only, so a type never gets runtime guidance.
    if (typeOnly) {
      addUsage(usages, {
        subpath, name, action: "review", rel, typeOnly,
        reason: "Type-only import; find the matching type in the WebView module.",
      });
      continue;
    }
    const resolved = resolveName(map, subpath, name);
    if (!resolved) {
      addUsage(usages, {
        subpath, name, action: "review", rel, typeOnly,
        reason: "Not a classified runtime export (possibly a type); review it manually.",
      });
      continue;
    }
    addUsage(usages, { ...resolved, name, rel, typeOnly });
  }
}

function resolveName(map, subpath, name) {
  const candidates = subpath === "."
    ? Object.keys(map.subpaths).filter((key) => bucketOf(map.subpaths[key], name))
    : [subpath];
  if (candidates.length === 0) return null;
  // Root imports: a subpath that re-exports the name from another candidate
  // (reexportsFrom) is not its owner, so report the module that defines it.
  const owner = candidates.find((key) =>
    !(map.subpaths[key].reexportsFrom ?? []).some((source) => candidates.includes(source))) ?? candidates[0];
  const entry = map.subpaths[owner];
  const bucket = bucketOf(entry, name);
  if (!bucket) return null;
  const base = { subpath: owner, webview: entry.webview, note: entry.note };
  if (bucket === "same") {
    return { ...base, action: "swap-import", reason: `Import the same name from ${entry.webview}.` };
  }
  if (bucket === "replaced") {
    const replacement = entry.replaced[name];
    return replacement.gap
      ? { ...base, action: "blocked", reason: replacement.use, gap: replacement.gap }
      : { ...base, action: "rewrite", reason: replacement.use };
  }
  return {
    ...base,
    action: "blocked",
    reason: "No WebView helper in this kit revision yet.",
    interim: entry.sdk3.length > 0 ? entry.sdk3 : undefined,
  };
}

function bucketOf(entry, name) {
  if (entry.same.includes(name)) return "same";
  if (Object.hasOwn(entry.replaced, name)) return "replaced";
  if (entry.pending.includes(name)) return "pending";
  return null;
}

function addUsage(usages, { rel, typeOnly, ...item }) {
  const key = `${item.subpath}\u0000${item.name ?? ""}\u0000${item.action}`;
  const existing = usages.get(key);
  if (existing) {
    existing.files.add(rel);
    return;
  }
  usages.set(key, { ...item, files: new Set([rel]) });
}

const MAX_LISTED_PATHS = 10;

function listPaths(paths) {
  if (paths.length <= MAX_LISTED_PATHS) return paths.join(", ");
  return `${paths.slice(0, MAX_LISTED_PATHS).join(", ")} and ${paths.length - MAX_LISTED_PATHS} more (see --json)`;
}

export function renderWebViewMigrationReport(result) {
  const lines = [];
  lines.push("WebView migration report (advisory)");
  lines.push(`Root: ${result.root}`);
  lines.push(`Stage: ${result.stage}`);
  const describe = (label, key) => {
    const value = result.footprint[key];
    lines.push(`  ${label}: declared in ${value.declaredIn.length} package.json, imported by ${value.importFiles.length} files`);
    if (value.declaredIn.length > 0) lines.push(`      Declared in: ${listPaths(value.declaredIn)}`);
    if (value.importFiles.length > 0) lines.push(`      Imported by: ${listPaths(value.importFiles)}`);
  };
  lines.push("Footprint:");
  describe("ait-rn", "aitRn");
  describe("@apps-in-toss/framework (RN SDK)", "rnSdk");
  describe("React Native UI packages", "rnUi");
  describe("ait-web", "aitWeb");
  describe("@apps-in-toss/web-framework (SDK 3)", "webSdk");
  lines.push(`  granite.config.*: ${result.configs.granite.length}, apps-in-toss.config.*: ${result.configs.appsInToss.length}`);
  if (result.configs.granite.length > 0) lines.push(`      granite.config.*: ${listPaths(result.configs.granite)}`);
  if (result.configs.appsInToss.length > 0) lines.push(`      apps-in-toss.config.*: ${listPaths(result.configs.appsInToss)}`);

  const sections = {
    blocked: "Blocked: no complete WebView replacement in this kit revision",
    rewrite: "Rewrite: use the WebView adapter API",
    "swap-import": "Swap import: same name exists for WebView",
    review: "Review manually",
  };
  const subpathLabel = (subpath) => `ait-rn${subpath === "." ? "" : `/${subpath}`}`;
  for (const action of ACTIONS) {
    const items = result.items.filter((item) => item.action === action);
    if (items.length === 0) continue;
    lines.push("");
    lines.push(`${sections[action]} (${items.length}):`);
    for (const item of items) {
      const label = item.name ? `${item.name} (${subpathLabel(item.subpath)})` : subpathLabel(item.subpath);
      lines.push(`  - ${label} [${item.files.length} file${item.files.length === 1 ? "" : "s"}]`);
      lines.push(`      ${item.reason}`);
      if (item.gap) lines.push(`      Gap: ${item.gap}`);
      if (item.interim) lines.push(`      Interim SDK 3 APIs: ${item.interim.join(", ")}`);
      lines.push(`      Files: ${listPaths(item.files)}`);
    }
  }
  if (result.items.length === 0) {
    lines.push("");
    lines.push("No ait-rn imports found.");
  }
  // Module notes carry behavior that a same-name swap does not show (for
  // example analytics needs an explicit mapEvent), so print each once.
  const notes = new Map();
  for (const item of result.items) {
    if (item.note && !notes.has(item.subpath)) notes.set(item.subpath, item.note);
  }
  if (notes.size > 0) {
    lines.push("");
    lines.push("Module notes:");
    for (const [subpath, note] of [...notes].sort(([left], [right]) => left.localeCompare(right))) {
      lines.push(`  - ${subpathLabel(subpath)}: ${note}`);
    }
  }
  for (const issue of result.scanIssues ?? []) lines.push(`Scan issue: ${issue}`);
  for (const warning of result.warnings) lines.push(`Warning: ${warning}`);
  for (const failure of result.failures) lines.push(`Failure: ${failure}`);
  lines.push("");
  lines.push(`Summary: ${result.summary.blocked} blocked, ${result.summary.rewrite} rewrite, ${result.summary["swap-import"]} swap-import, ${result.summary.review} review.`);
  lines.push("Static analysis only; QR/device checks still decide login, payment, ad and storage continuity.");
  return lines.join("\n");
}

function toPosix(path) {
  return path.split(sep).join("/");
}

const USAGE = "Usage: node scripts/check-consumer-webview-migration.mjs --root <consumer-root> [--json] [--strict]";

function parseArgs(argv) {
  const options = { strict: process.env.CI_STRICT === "1" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help") return { help: true };
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--strict") {
      options.strict = true;
      continue;
    }
    if (arg === "--root" || arg === "--map") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}.`);
      options[arg.slice(2)] = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }
  if (!options.root) throw new Error(USAGE);
  return options;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      console.log(USAGE);
      process.exit(0);
    }
    const map = loadMigrationMap(options.map ?? DEFAULT_MAP_PATH);
    const result = checkConsumerWebViewMigration({ root: options.root, map, strict: options.strict });
    console.log(options.json ? JSON.stringify(result, null, 2) : renderWebViewMigrationReport(result));
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
}
