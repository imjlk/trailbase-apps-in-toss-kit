import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
    assert.equal(item(result, "AppsInTossLoginBridgeError", "login").action, "rewrite");

    // Platform-neutral backend clients are shared through ait-core.
    const message = item(result, "createAppsInTossFunctionalMessageClient", "notifications");
    assert.equal(message.action, "swap-import");
    assert.match(message.reason, /ait-web\/notifications/);

    const diagnostics = item(result, "collectAppsInTossRuntimeDiagnostics", "diagnostics");
    assert.equal(diagnostics.action, "blocked");
    assert.ok(diagnostics.interim.includes("getOperationalEnvironment"));

    const iap = item(result, "createAppsInTossIapBridge", "iap");
    assert.equal(iap.action, "blocked");
    assert.match(iap.gap, /restorePendingOrders/);

    // A root import resolves to the module that owns the helper, not to ads,
    // which only re-exports it.
    const platform = item(result, "safeGetAppsInTossPlatformOS");
    assert.equal(platform.subpath, "runtime");
    assert.equal(platform.action, "blocked");
    assert.ok(platform.interim.includes("getPlatformOS"));

    assert.equal(item(result, "AnalyticsPayload", "analytics").action, "review");
    const namespace = result.items.find((entry) => entry.subpath === "share" && entry.name === null);
    assert.equal(namespace.action, "review");

    assert.equal(result.items.some((entry) => entry.subpath === "shopping"), false, "skipped directories leak");
    assert.deepEqual(result.footprint.aitRn.declaredIn, ["apps/app-rn/package.json"]);
    assert.deepEqual(result.footprint.rnSdk.importFiles, ["apps/app-rn/src/session.ts"]);
    assert.deepEqual(result.footprint.rnUi.importFiles, ["apps/app-rn/src/session.ts"]);
    assert.deepEqual(result.configs.granite, ["apps/app-rn/granite.config.ts"]);
    assert.deepEqual(result.warnings, []);
    assert.equal(result.summary.blocked, 3);

    // Blocked items are listed first so the report leads with what stops a cutover.
    assert.equal(result.items[0].action, "blocked");
    const report = renderWebViewMigrationReport(result);
    assert.match(report, /Stage: rn-only/);
    assert.match(report, /Gap: restorePendingOrders/);
    assert.match(report, /Interim SDK 3 APIs: .*getPlatformOS/);
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
