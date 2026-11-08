import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  checkConsumerWebViewMigration,
  loadMigrationMap,
  parseImports,
  renderWebViewMigrationReport,
} from "./check-consumer-webview-migration.mjs";

const script = fileURLToPath(new URL("./check-consumer-webview-migration.mjs", import.meta.url));
const map = loadMigrationMap();
const RN = "@trailbase-apps-in-toss-kit/ait-rn";

function fixture(files) {
  const root = mkdtempSync(join(tmpdir(), "webview-migration-"));
  for (const [path, content] of Object.entries(files)) {
    const target = join(root, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, typeof content === "string" ? content : `${JSON.stringify(content, null, 2)}\n`);
  }
  return root;
}

function item(result, name, subpath) {
  return result.items.find((entry) => entry.name === name && (subpath === undefined || entry.subpath === subpath));
}

const rnConsumer = () => fixture({
  "package.json": { name: "fixture-monorepo", private: true, workspaces: ["apps/*"] },
  "apps/app-rn/package.json": {
    name: "fixture-app-rn",
    dependencies: {
      "@apps-in-toss/framework": "2.10.13",
      "@trailbase-apps-in-toss-kit/ait-rn": "workspace:*",
      "react-native": "0.84.0",
    },
  },
  "apps/app-rn/granite.config.ts": "export default {};\n",
  "apps/app-rn/src/session.ts": [
    `import { createPersistentJsonAtom } from "${RN}/storage";`,
    `import {`,
    `  createAppsInTossLoginBridge,`,
    `  type AppsInTossLoginBridgeError as LoginError,`,
    `} from "${RN}/login";`,
    `import { createAppsInTossFunctionalMessageClient } from '${RN}/notifications';`,
    `import { collectAppsInTossRuntimeDiagnostics } from '${RN}/diagnostics';`,
    `import { createAppsInTossIapBridge } from "${RN}/iap";`,
    `import type { AnalyticsPayload } from "${RN}/analytics";`,
    `import { safeGetAppsInTossPlatformOS } from "${RN}";`,
    `import * as share from "${RN}/share";`,
    `import { View } from "react-native";`,
    `import { appLogin } from "@apps-in-toss/framework";`,
  ].join("\n"),
  "apps/app-rn/src/other.tsx": `import { createPersistentJsonAtom as atom } from "${RN}/storage";\n`,
  "vendor/trailbase-apps-in-toss-kit/packages/ait-rn/src/x.ts": `import { createAppsInTossShoppingBridge } from "${RN}/shopping";\n`,
  "node_modules/pkg/index.js": `import { createAppsInTossShoppingBridge } from "${RN}/shopping";\n`,
  ".cache/generated.ts": `import { createAppsInTossShoppingBridge } from "${RN}/shopping";\n`,
});

test("classifies RN imports by the migration map", () => {
  const root = rnConsumer();
  try {
    const result = checkConsumerWebViewMigration({ root, map });
    assert.equal(result.stage, "rn-only");
    assert.equal(result.ok, true);

    const atom = item(result, "createPersistentJsonAtom", "storage");
    assert.equal(atom.action, "swap-import");
    assert.deepEqual(atom.files, ["apps/app-rn/src/other.tsx", "apps/app-rn/src/session.ts"]);
    assert.match(atom.reason, /ait-web\/storage/);

    assert.equal(item(result, "createAppsInTossLoginBridge", "login").action, "rewrite");
    // The map classifies runtime exports only; a type import is reviewed by hand.
    const loginError = item(result, "AppsInTossLoginBridgeError", "login");
    assert.equal(loginError.action, "review");
    assert.match(loginError.reason, /Type-only import/);

    // Platform-neutral backend clients are shared through ait-core.
    const message = item(result, "createAppsInTossFunctionalMessageClient", "notifications");
    assert.equal(message.action, "swap-import");
    assert.match(message.reason, /ait-web\/notifications/);

    const diagnostics = item(result, "collectAppsInTossRuntimeDiagnostics", "diagnostics");
    assert.equal(diagnostics.action, "swap-import");
    assert.match(diagnostics.reason, /ait-web\/diagnostics/);

    const iap = item(result, "createAppsInTossIapBridge", "iap");
    assert.equal(iap.action, "rewrite");
    assert.match(iap.reason, /createAppsInTossIapRestoreBridge\(\)/);
    assert.equal(iap.gap, undefined);

    // A root import resolves to the module that owns the helper, not to ads,
    // which only re-exports it.
    const platform = item(result, "safeGetAppsInTossPlatformOS");
    assert.equal(platform.subpath, "runtime");
    assert.equal(platform.action, "swap-import");
    assert.match(platform.reason, /ait-web\/runtime/);

    assert.equal(item(result, "AnalyticsPayload", "analytics").action, "review");
    const namespace = result.items.find((entry) => entry.subpath === "share" && entry.name === null);
    assert.equal(namespace.action, "review");

    assert.equal(result.items.some((entry) => entry.subpath === "shopping"), false, "skipped directories leak");
    assert.deepEqual(result.footprint.aitRn.declaredIn, ["apps/app-rn/package.json"]);
    assert.deepEqual(result.footprint.rnSdk.importFiles, ["apps/app-rn/src/session.ts"]);
    assert.deepEqual(result.footprint.rnUi.importFiles, ["apps/app-rn/src/session.ts"]);
    assert.deepEqual(result.configs.granite, ["apps/app-rn/granite.config.ts"]);
    assert.deepEqual(result.warnings, []);
    // Every ait-rn subpath has a WebView path at this kit revision.
    assert.equal(result.summary.blocked, 0);
    assert.equal(result.items[0].action, "rewrite");
    assert.deepEqual(result.scanIssues, []);
    const report = renderWebViewMigrationReport(result);
    assert.match(report, /Stage: rn-only/);
    // Paths and module notes are in the text report, not only in --json.
    assert.match(report, /Declared in: apps\/app-rn\/package\.json/);
    assert.match(report, /granite\.config\.\*: apps\/app-rn\/granite\.config\.ts/);
    assert.match(report, /Files: apps\/app-rn\/src\/other\.tsx, apps\/app-rn\/src\/session\.ts/);
    assert.match(report, /Module notes:\n(?:.*\n)*  - ait-rn\/storage: /);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("pending names and replacement gaps are blocked and listed first", () => {
  // The shipped map has no gaps left; a narrowed copy keeps the blocked path covered.
  const narrowed = structuredClone(map);
  const runtime = narrowed.subpaths.runtime;
  Object.assign(runtime, { webview: null, pending: runtime.same, same: [], sdk3: ["getPlatformOS"] });
  narrowed.subpaths.ads.pending = narrowed.subpaths.ads.same.filter((name) => runtime.pending.includes(name));
  narrowed.subpaths.ads.same = narrowed.subpaths.ads.same.filter((name) => !runtime.pending.includes(name));
  narrowed.subpaths.iap.replaced.createAppsInTossIapBridge.gap = "restorePendingOrders fixture gap";
  const root = rnConsumer();
  try {
    const result = checkConsumerWebViewMigration({ root, map: narrowed });
    const platform = item(result, "safeGetAppsInTossPlatformOS");
    assert.equal(platform.subpath, "runtime");
    assert.equal(platform.action, "blocked");
    assert.deepEqual(platform.interim, ["getPlatformOS"]);
    assert.equal(item(result, "createAppsInTossIapBridge", "iap").action, "blocked");
    assert.equal(result.summary.blocked, 2);
    // Blocked items are listed first so the report leads with what stops a cutover.
    assert.deepEqual(result.items.slice(0, 2).map((entry) => entry.action), ["blocked", "blocked"]);
    const report = renderWebViewMigrationReport(result);
    assert.match(report, /Gap: restorePendingOrders fixture gap/);
    assert.match(report, /Interim SDK 3 APIs: getPlatformOS/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("strict mode fails while any RN footprint remains", () => {
  const root = rnConsumer();
  try {
    const result = checkConsumerWebViewMigration({ root, map, strict: true });
    assert.equal(result.ok, false);
    assert.match(result.failures[0], /React Native footprint remains/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("reports dual and WebView-only stages and SDK 3 config placement", () => {
  const dual = fixture({
    "apps/app-rn/package.json": { dependencies: { "@apps-in-toss/framework": "2.10.13" } },
    "apps/app-rn/granite.config.ts": "export default {};\n",
    "apps/app-web/package.json": {
      dependencies: { "@apps-in-toss/web-framework": "3.9.0", "@trailbase-apps-in-toss-kit/ait-web": "workspace:*" },
    },
    "apps/app-web/apps-in-toss.config.ts": "export default {};\n",
    "apps/app-web/src/platform.ts": `import { createAppsInTossWebAdapter } from "@trailbase-apps-in-toss-kit/ait-web";\n`,
  });
  const webOnly = fixture({
    "package.json": { dependencies: { "@apps-in-toss/web-framework": "3.9.0" } },
    "granite.config.ts": "export default {};\n",
  });
  try {
    const dualResult = checkConsumerWebViewMigration({ root: dual, map, strict: true });
    assert.equal(dualResult.stage, "dual");
    assert.equal(dualResult.ok, false);
    assert.deepEqual(dualResult.warnings, [], "RN app's granite config is expected");
    assert.deepEqual(dualResult.configs.appsInToss, ["apps/app-web/apps-in-toss.config.ts"]);
    assert.deepEqual(dualResult.footprint.aitWeb.importFiles, ["apps/app-web/src/platform.ts"]);

    const webResult = checkConsumerWebViewMigration({ root: webOnly, map, strict: true });
    assert.equal(webResult.stage, "webview-only");
    assert.equal(webResult.ok, true);
    assert.equal(webResult.items.length, 0);
    assert.match(webResult.warnings[0], /granite\.config\.ts belongs to a WebView package/);
  } finally {
    rmSync(dual, { recursive: true, force: true });
    rmSync(webOnly, { recursive: true, force: true });
  }
});

test("comments and string contents never count as imports", () => {
  const root = fixture({
    "package.json": { dependencies: { "@apps-in-toss/web-framework": "3.9.0" } },
    "src/app.tsx": [
      `// import { createAppsInTossLoginBridge } from "${RN}/login";`,
      `/* import { createPersistentJsonAtom } from "${RN}/storage"; */`,
      `const example = "import { createAppsInTossIapBridge } from '${RN}/iap'";`,
      "const template = `",
      `  import { collectAppsInTossRuntimeDiagnostics } from "${RN}/diagnostics";`,
      "`;",
      `const quote = /'/; const slash = /["/]/g;`,
      `export const view = <p>Don't import from "${RN}/share" here</p>;`,
      `import { createAppsInTossWebAdapter } from "@trailbase-apps-in-toss-kit/ait-web";`,
    ].join("\n"),
  });
  try {
    const result = checkConsumerWebViewMigration({ root, map, strict: true });
    assert.equal(result.stage, "webview-only");
    assert.equal(result.ok, true, result.failures.join("; "));
    assert.deepEqual(result.items, []);
    assert.deepEqual(result.footprint.aitWeb.importFiles, ["src/app.tsx"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("comments between import tokens do not hide an RN import", () => {
  const root = fixture({
    "package.json": { dependencies: { "@apps-in-toss/web-framework": "3.9.0" } },
    "src/a.ts": [
      `const ratio = total / count; const pattern = /it's/;`,
      `import /* kept for migration */ { createPersistentJsonAtom } from /* rn */ "${RN}/storage";`,
      `import {`,
      `  // still used`,
      `  createAppsInTossShoppingBridge,`,
      `} from '${RN}/shopping';`,
      `import{createAppsInTossPromotionCampaignClient}from"${RN}/promotion";`,
    ].join("\n"),
  });
  try {
    const result = checkConsumerWebViewMigration({ root, map, strict: true });
    assert.equal(result.stage, "dual");
    assert.equal(result.ok, false);
    assert.equal(item(result, "createPersistentJsonAtom", "storage").action, "swap-import");
    assert.equal(item(result, "createAppsInTossShoppingBridge", "shopping").action, "swap-import");
    assert.equal(item(result, "createAppsInTossPromotionCampaignClient", "promotion").action, "swap-import");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("imports inside template interpolations are code, template text is not", () => {
  const root = fixture({
    "package.json": { dependencies: { "@apps-in-toss/web-framework": "3.9.0" } },
    "src/text.ts": `const label = \`\${name} import { createAppsInTossIapBridge } from "${RN}/iap"\`;\n`,
    "src/lazy.ts": `const view = \`\${(await import("${RN}/diagnostics")).collectAppsInTossRuntimeDiagnostics}\`;\n`,
  });
  try {
    const result = checkConsumerWebViewMigration({ root, map, strict: true });
    assert.deepEqual(result.footprint.aitRn.importFiles, ["src/lazy.ts"]);
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].subpath, "diagnostics");
    assert.equal(result.ok, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("slash context tells division from regex literals", () => {
  const imports = parseImports([
    `let half = count++ / 2; const share = await import("${RN}/share"); const ratio = 1 / 2;`,
    `if (ready) /from "${RN}\\/iap"/.test(text);`,
    `const mean = (a + b) / 2; const login = await import("${RN}/login"); const third = mean / 3;`,
  ].join("\n"));
  assert.deepEqual(imports.map((entry) => entry.specifier), [`${RN}/share`, `${RN}/login`]);
});

test("escaped specifiers and quoted import names are decoded", () => {
  const imports = parseImports([
    `import legacy from "\\u0040trailbase-apps-in-toss-kit/ait-rn/login";`,
    `import { "createPersistentJsonAtom" as atom } from "\\x40trailbase-apps-in-toss-kit\\u{2F}ait-rn/storage";`,
  ].join("\n"));
  assert.deepEqual(imports, [
    { specifier: `${RN}/login`, kind: "default", names: [] },
    { specifier: `${RN}/storage`, kind: "named", names: [{ name: "createPersistentJsonAtom", typeOnly: false }] },
  ]);
  const root = fixture({ "src/a.ts": `import { "createPersistentJsonAtom" as atom } from "\\u0040trailbase-apps-in-toss-kit/ait-rn/storage";\n` });
  try {
    const result = checkConsumerWebViewMigration({ root, map, strict: true });
    assert.equal(item(result, "createPersistentJsonAtom", "storage").action, "swap-import");
    assert.equal(result.ok, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a missing or non-directory root is an error, not an empty scan", () => {
  const root = fixture({ "file.txt": "not a directory\n" });
  try {
    assert.throws(() => checkConsumerWebViewMigration({ root: join(root, "missing"), map, strict: true }), /does not exist or cannot be read/);
    assert.throws(() => checkConsumerWebViewMigration({ root: join(root, "file.txt"), map }), /is not a directory/);
    const cli = spawnSync(process.execPath, [script, "--root", join(root, "missing"), "--strict"], { encoding: "utf8" });
    assert.equal(cli.status, 2);
    assert.match(cli.stderr, /does not exist or cannot be read/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an incomplete scan is reported and fails strict mode", () => {
  const root = fixture({
    "package.json": { dependencies: { "@apps-in-toss/web-framework": "3.9.0" } },
    "apps/legacy/package.json": "{ not json",
    "src/a.ts": `import { createAppsInTossWebAdapter } from "@trailbase-apps-in-toss-kit/ait-web";\n`,
  });
  try {
    const advisory = checkConsumerWebViewMigration({ root, map });
    assert.equal(advisory.ok, true);
    assert.deepEqual(advisory.scanIssues, ["Could not parse apps/legacy/package.json."]);
    assert.deepEqual(advisory.warnings, []);
    const strict = checkConsumerWebViewMigration({ root, map, strict: true });
    assert.equal(strict.stage, "webview-only");
    assert.equal(strict.ok, false);
    assert.match(strict.failures[0], /Scan incomplete \(1 issue\)/);
    assert.match(renderWebViewMigrationReport(strict), /Scan issue: Could not parse apps\/legacy\/package\.json\./);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("oversized, unreadable files and unreadable directories are scan issues", { skip: process.platform === "win32" || process.getuid?.() === 0 }, () => {
  const root = fixture({
    "package.json": { dependencies: { "@apps-in-toss/web-framework": "3.9.0" } },
    "src/big.ts": `export const blob = "${"x".repeat(2 * 1024 * 1024)}";\n`,
    "src/locked.ts": `import { createPersistentJsonAtom } from "${RN}/storage";\n`,
    "src/private/hidden.ts": `import { createPersistentJsonAtom } from "${RN}/storage";\n`,
  });
  chmodSync(join(root, "src/locked.ts"), 0o000);
  chmodSync(join(root, "src/private"), 0o000);
  try {
    const advisory = checkConsumerWebViewMigration({ root, map });
    assert.deepEqual(advisory.scanIssues, [
      "Could not read directory src/private.",
      "Skipped src/big.ts: larger than 2 MiB, so its imports were not checked.",
      "Could not read src/locked.ts.",
    ]);
    assert.equal(advisory.ok, true);
    const strict = checkConsumerWebViewMigration({ root, map, strict: true });
    assert.equal(strict.ok, false);
    assert.match(strict.failures[0], /Scan incomplete \(3 issues\)/);
  } finally {
    chmodSync(join(root, "src/private"), 0o755);
    chmodSync(join(root, "src/locked.ts"), 0o644);
    rmSync(root, { recursive: true, force: true });
  }
});

test("unknown subpaths are reviewed instead of guessed", () => {
  const root = fixture({ "src/a.ts": `import { futureHelper } from "${RN}/future";\n` });
  try {
    const result = checkConsumerWebViewMigration({ root, map });
    assert.equal(result.items[0].action, "review");
    assert.equal(result.items[0].subpath, "future");
    assert.match(result.warnings[0], /Unknown ait-rn subpath 'future'/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("parses named, aliased, type-only, re-export and dynamic imports", () => {
  const imports = parseImports([
    `import def, { a as b, type C } from "x";`,
    `import type { D } from "y";`,
    `export * from "z";`,
    `export * as ns from "w";`,
    `export { e } from "v";`,
    `import "side";`,
    `const lazy = await import("dyn");`,
    `const legacy = require('req');`,
    `import type from "./type-default";`,
    `export type { F } from "u";`,
  ].join("\n"));
  const by = (specifier) => imports.filter((entry) => entry.specifier === specifier);
  assert.deepEqual(by("x").find((entry) => entry.kind === "named").names, [
    { name: "a", typeOnly: false },
    { name: "C", typeOnly: true },
  ]);
  assert.ok(by("x").some((entry) => entry.kind === "default"));
  assert.deepEqual(by("y")[0].names, [{ name: "D", typeOnly: true }]);
  assert.equal(by("z")[0].kind, "reexport-all");
  assert.equal(by("w")[0].kind, "namespace");
  assert.deepEqual(by("v")[0].names, [{ name: "e", typeOnly: false }]);
  assert.equal(by("side")[0].kind, "side-effect");
  assert.equal(by("dyn")[0].kind, "dynamic");
  assert.equal(by("req")[0].kind, "dynamic");
  assert.equal(by("./type-default")[0].kind, "default");
  assert.deepEqual(by("u")[0].names, [{ name: "F", typeOnly: true }]);
});

test("analytics notes reach the text report for a same-name swap and a namespace import", () => {
  const root = fixture({ "src/a.ts": `import { createAppsInTossAnalyticsConfig } from "${RN}/analytics";\n` });
  try {
    const report = renderWebViewMigrationReport(checkConsumerWebViewMigration({ root, map }));
    assert.match(report, /ait-rn\/analytics: .*mapEvent/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  const namespaced = fixture({ "src/a.ts": `import * as analytics from "${RN}/analytics";\n` });
  try {
    const result = checkConsumerWebViewMigration({ root: namespaced, map });
    assert.equal(result.items[0].action, "review");
    assert.match(result.items[0].note, /mapEvent/);
    assert.match(renderWebViewMigrationReport(result), /Module notes:\n {2}- ait-rn\/analytics: .*mapEvent/);
  } finally {
    rmSync(namespaced, { recursive: true, force: true });
  }
});

test("migration map names keep one classification across re-exports", () => {
  const buckets = new Map();
  for (const [subpath, entry] of Object.entries(map.subpaths)) {
    const pairs = [
      ...entry.same.map((name) => [name, "same"]),
      ...Object.keys(entry.replaced).map((name) => [name, "replaced"]),
      ...entry.pending.map((name) => [name, "pending"]),
    ];
    for (const [name, bucket] of pairs) {
      const previous = buckets.get(name);
      assert.ok(!previous || previous.bucket === bucket, `${name}: ${previous?.subpath}=${previous?.bucket} vs ${subpath}=${bucket}`);
      buckets.set(name, { subpath, bucket });
    }
    for (const replacement of Object.values(entry.replaced)) {
      assert.equal(typeof replacement.use, "string");
      assert.ok(replacement.gap === undefined || typeof replacement.gap === "string");
    }
  }
});

test("names shared by two subpaths are declared as re-exports", () => {
  const owners = new Map();
  for (const [subpath, entry] of Object.entries(map.subpaths)) {
    for (const source of entry.reexportsFrom ?? []) assert.ok(map.subpaths[source], `${subpath} re-exports unknown ${source}`);
    for (const name of [...entry.same, ...Object.keys(entry.replaced), ...entry.pending]) {
      owners.set(name, [...(owners.get(name) ?? []), subpath]);
    }
  }
  for (const [name, subpaths] of owners) {
    if (subpaths.length < 2) continue;
    const declared = subpaths.filter((subpath) =>
      (map.subpaths[subpath].reexportsFrom ?? []).some((source) => subpaths.includes(source)));
    assert.equal(declared.length, subpaths.length - 1, `${name} appears in ${subpaths.join(", ")}`);
  }
});

test("English and Korean guides list every mapped subpath", () => {
  for (const language of ["en", "ko"]) {
    const guide = readFileSync(fileURLToPath(new URL(`../docs/${language}/webview-migration.md`, import.meta.url)), "utf8");
    const rows = [...guide.matchAll(/^\| `ait-rn\/([a-z-]+)` \|/gm)].map((match) => match[1]).sort();
    assert.deepEqual(rows, Object.keys(map.subpaths).sort(), `docs/${language}/webview-migration.md`);
  }
});

test("CLI prints JSON, honors --strict and CI_STRICT, and rejects bad arguments", () => {
  const root = rnConsumer();
  try {
    const json = spawnSync(process.execPath, [script, "--root", root, "--json"], { encoding: "utf8", env: { ...process.env, CI_STRICT: "" } });
    assert.equal(json.status, 0, json.stderr);
    assert.equal(JSON.parse(json.stdout).stage, "rn-only");

    const strict = spawnSync(process.execPath, [script, "--root", root, "--strict"], { encoding: "utf8" });
    assert.equal(strict.status, 1);
    assert.match(strict.stdout, /Failure: React Native footprint remains/);

    const ci = spawnSync(process.execPath, [script, "--root", root], { encoding: "utf8", env: { ...process.env, CI_STRICT: "1" } });
    assert.equal(ci.status, 1);

    const bad = spawnSync(process.execPath, [script, "--unknown"], { encoding: "utf8" });
    assert.equal(bad.status, 2);
    assert.match(bad.stderr, /Unknown option/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
